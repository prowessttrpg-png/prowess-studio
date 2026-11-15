//go:build windows

package main

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"syscall"
	"time"
	"unsafe"
)

var (
	kernel          = syscall.NewLazyDLL("kernel32.dll")
	user            = syscall.NewLazyDLL("user32.dll")
	shell           = syscall.NewLazyDLL("shell32.dll")
	procLock        = kernel.NewProc("LockFileEx")
	procDefine      = kernel.NewProc("DefineDosDeviceW")
	procQuery       = kernel.NewProc("QueryDosDeviceW")
	procCreateJob   = kernel.NewProc("CreateJobObjectW")
	procSetJob      = kernel.NewProc("SetInformationJobObject")
	procAssignJob   = kernel.NewProc("AssignProcessToJobObject")
	procKnownFolder = shell.NewProc("SHGetKnownFolderPath")
	procShell       = shell.NewProc("ShellExecuteW")
	procFree        = syscall.NewLazyDLL("ole32.dll").NewProc("CoTaskMemFree")
)

func wide(value string) *uint16 { return syscall.StringToUTF16Ptr(value) }
func ptr(value *uint16) uintptr { return uintptr(unsafe.Pointer(value)) }

func fail(message string) {
	user.NewProc("MessageBoxW").Call(0, ptr(wide(message)), ptr(wide("Prowess Studio")), 0x10)
}

func dataDirectory() (string, error) {
	id := syscall.GUID{Data1: 0xf1b32785, Data2: 0x6fba, Data3: 0x4fcf,
		Data4: [8]byte{0x9d, 0x55, 0x7b, 0x8e, 0x7f, 0x15, 0x70, 0x91}}
	var value *uint16
	result, _, _ := procKnownFolder.Call(uintptr(unsafe.Pointer(&id)), 0, 0, uintptr(unsafe.Pointer(&value)))
	if result != 0 || value == nil {
		return "", errors.New("Windows could not find your local application data folder.")
	}
	defer procFree.Call(uintptr(unsafe.Pointer(value)))
	root := filepath.Join(syscall.UTF16ToString(unsafe.Slice(value, 32768)), "Prowess Studio Data")
	return root, os.MkdirAll(root, 0700)
}

func acquire(root string) (*os.File, error) {
	file, err := os.OpenFile(filepath.Join(root, "lifecycle.lock"), os.O_CREATE|os.O_RDWR, 0600)
	if err != nil {
		return nil, err
	}
	var overlapped syscall.Overlapped
	ok, _, callErr := procLock.Call(file.Fd(), 3, 0, 1, 0, uintptr(unsafe.Pointer(&overlapped)))
	if ok == 0 {
		file.Close()
		return nil, callErr
	}
	return file, nil
}

func dosTarget(name string) string {
	var buffer [32768]uint16
	ok, _, _ := procQuery.Call(ptr(wide(name)), uintptr(unsafe.Pointer(&buffer[0])), uintptr(len(buffer)))
	if ok == 0 {
		return ""
	}
	return syscall.UTF16ToString(buffer[:])
}

func postgresPath(root string) (string, func(), error) {
	if strings.IndexFunc(root, func(r rune) bool { return r < 32 || r > 126 }) < 0 {
		return root, func() {}, nil
	}
	target := `\??\` + root
	for drive := 'Z'; drive >= 'D'; drive-- {
		name := string(drive) + ":"
		current := dosTarget(name)
		if current != "" && !strings.EqualFold(current, target) {
			continue
		}
		if current == "" {
			ok, _, _ := procDefine.Call(1|8, ptr(wide(name)), ptr(wide(target)))
			if ok == 0 {
				continue
			}
		}
		if !strings.EqualFold(dosTarget(name), target) {
			procDefine.Call(1|2|4|8, ptr(wide(name)), ptr(wide(target)))
			continue
		}
		return name + `\`, func() { procDefine.Call(1|2|4|8, ptr(wide(name)), ptr(wide(target))) }, nil
	}
	return "", nil, errors.New("Windows could not create a local PostgreSQL path for this account.")
}

type basicJobLimits struct {
	ProcessTime, JobTime           int64
	Flags                          uint32
	WorkingSetMin, WorkingSetMax   uintptr
	ActiveProcessLimit             uint32
	Affinity                       uintptr
	PriorityClass, SchedulingClass uint32
}
type extendedJobLimits struct {
	Basic                                                      basicJobLimits
	Counters                                                   [6]uint64
	ProcessMemory, JobMemory, PeakProcessMemory, PeakJobMemory uintptr
}

func jobFor(pid int) (syscall.Handle, error) {
	handle, _, err := procCreateJob.Call(0, 0)
	if handle == 0 {
		return 0, err
	}
	job := syscall.Handle(handle)
	info := extendedJobLimits{Basic: basicJobLimits{Flags: 0x2000}}
	ok, _, err := procSetJob.Call(handle, 9, uintptr(unsafe.Pointer(&info)), unsafe.Sizeof(info))
	if ok == 0 {
		syscall.CloseHandle(job)
		return 0, err
	}
	process, err := syscall.OpenProcess(0x0100|0x0001, false, uint32(pid))
	if err != nil {
		syscall.CloseHandle(job)
		return 0, err
	}
	defer syscall.CloseHandle(process)
	ok, _, err = procAssignJob.Call(handle, uintptr(process))
	if ok == 0 {
		syscall.CloseHandle(job)
		return 0, err
	}
	return job, nil
}

type control struct {
	Origin string `json:"origin"`
	Token  string `json:"token"`
}
type launcherStatus struct {
	Message string `json:"message"`
}

const prefix = "/__prowess_desktop"

func command(root, action string) (string, error) {
	var current control
	raw, err := os.ReadFile(filepath.Join(root, "control.json"))
	if err != nil {
		return "", err
	}
	if err := json.Unmarshal(raw, &current); err != nil {
		return "", err
	}
	origin, err := url.Parse(current.Origin)
	if err != nil || origin.Scheme != "http" || origin.Hostname() != "127.0.0.1" ||
		origin.Port() == "" || origin.Path != "" || origin.RawQuery != "" || origin.Fragment != "" || len(current.Token) != 64 {
		return "", errors.New("The local launcher address is invalid.")
	}
	request, err := http.NewRequest(http.MethodPost, current.Origin+prefix+"/control", strings.NewReader(action))
	if err != nil {
		return "", err
	}
	request.Header.Set("X-Prowess-Control", current.Token)
	client := &http.Client{Timeout: 2 * time.Second, Transport: &http.Transport{}, CheckRedirect: func(*http.Request, []*http.Request) error {
		return http.ErrUseLastResponse
	}}
	defer client.CloseIdleConnections()
	response, err := client.Do(request)
	if err != nil {
		return "", err
	}
	defer response.Body.Close()
	raw, err = io.ReadAll(io.LimitReader(response.Body, 2048))
	if err != nil || response.StatusCode != http.StatusOK {
		return "", errors.New("The local launcher is still preparing.")
	}
	address := string(bytes.TrimSpace(raw))
	if action == "quit" {
		return "", nil
	}
	if !strings.HasPrefix(address, current.Origin+prefix+"/launch#") {
		return "", errors.New("The local launcher address did not match this session.")
	}
	return address, nil
}

func browser(root, action string) error {
	var err error
	for until := time.Now().Add(15 * time.Second); time.Now().Before(until); {
		var address string
		address, err = command(root, action)
		if err == nil {
			ok, _, _ := procShell.Call(0, ptr(wide("open")), ptr(wide(address)), 0, 0, 1)
			if ok <= 32 {
				return errors.New("Windows could not open the default browser.")
			}
			return nil
		}
		time.Sleep(250 * time.Millisecond)
	}
	return err
}

type winMessage struct {
	Hwnd           uintptr
	Message        uint32
	WParam, LParam uintptr
	Time           uint32
	X, Y           int32
	Private        uint32
}
type windowClass struct {
	Style                                                   uint32
	Callback                                                uintptr
	ClassExtra, WindowExtra                                 int32
	Instance, Icon, Cursor, Background, MenuName, ClassName uintptr
}

func showWindow(root string, stdin io.WriteCloser, done <-chan error) error {
	runtime.LockOSThread()
	var title, statusLabel uintptr
	var deadline time.Time
	var startupError error
	closing := false
	opened := false
	closeWorker := func() {
		if closing {
			return
		}
		closing = true
		deadline = time.Now().Add(20 * time.Second)
		stdin.Close()
	}
	setLabel := func(text string) { user.NewProc("SetWindowTextW").Call(statusLabel, ptr(wide(text))) }
	callback := syscall.NewCallback(func(hwnd uintptr, msg uint32, w, l uintptr) uintptr {
		switch msg {
		case 0x0111:
			switch w & 0xffff {
			case 1, 2:
				action := "open"
				if w&0xffff == 2 {
					action = "manage"
				}
				go func() {
					if err := browser(root, action); err != nil {
						fail(err.Error())
					}
				}()
			case 3:
				closeWorker()
			}
			return 0
		case 0x0010:
			closeWorker()
			return 0
		case 0x0011:
			return 1
		case 0x0016:
			if w != 0 {
				closeWorker()
			}
			return 0
		case 0x0113:
			select {
			case err := <-done:
				startupError = err
				user.NewProc("DestroyWindow").Call(hwnd)
				return 0
			default:
			}
			if closing {
				setLabel("Closing Studio and PostgreSQL…")
				if time.Now().After(deadline) {
					startupError = errors.New("Studio took too long to close. Reopen it to recover the workspace.")
					user.NewProc("DestroyWindow").Call(hwnd)
				}
				return 0
			}
			var status launcherStatus
			raw, err := os.ReadFile(filepath.Join(root, "status.json"))
			if err == nil && json.Unmarshal(raw, &status) == nil {
				setLabel(status.Message)
			}
			if !opened {
				if _, err := os.Stat(filepath.Join(root, "control.json")); err == nil {
					opened = true
					go func() {
						if err := browser(root, "open"); err != nil {
							fail(err.Error())
						}
					}()
				}
			}
			return 0
		case 0x0002:
			user.NewProc("PostQuitMessage").Call(0)
			return 0
		}
		value, _, _ := user.NewProc("DefWindowProcW").Call(hwnd, uintptr(msg), w, l)
		return value
	})
	instance, _, _ := kernel.NewProc("GetModuleHandleW").Call(0)
	className := wide("ProwessStudioLauncher")
	class := windowClass{Callback: callback, Instance: instance, Background: 6, ClassName: ptr(className)}
	registered, _, err := user.NewProc("RegisterClassW").Call(uintptr(unsafe.Pointer(&class)))
	if registered == 0 {
		return err
	}
	window := user.NewProc("CreateWindowExW")
	title, _, err = window.Call(0, ptr(className), ptr(wide("Prowess Studio")), 0x10ca0000, 0x80000000, 0x80000000,
		530, 195, 0, 0, instance, 0)
	if title == 0 {
		return err
	}
	statusLabel, _, _ = window.Call(0, ptr(wide("STATIC")), ptr(wide("Checking the Prowess Studio installation.")),
		0x50000000, 22, 24, 470, 60, title, 0, instance, 0)
	for i, text := range []string{"Open Studio", "Manage Workspace", "Quit"} {
		window.Call(0, ptr(wide("BUTTON")), ptr(wide(text)), 0x50010000,
			uintptr(22+i*163), 96, 155, 32, title, uintptr(i+1), instance, 0)
	}
	user.NewProc("SetTimer").Call(title, 1, 250, 0)
	var message winMessage
	for {
		value, _, callErr := user.NewProc("GetMessageW").Call(uintptr(unsafe.Pointer(&message)), 0, 0, 0)
		if int32(value) == -1 {
			return callErr
		}
		if value == 0 {
			return startupError
		}
		user.NewProc("TranslateMessage").Call(uintptr(unsafe.Pointer(&message)))
		user.NewProc("DispatchMessageW").Call(uintptr(unsafe.Pointer(&message)))
	}
}

func run() error {
	root, err := dataDirectory()
	if err != nil {
		return err
	}
	lock, err := acquire(root)
	quit := len(os.Args) == 2 && os.Args[1] == "--quit"
	if errors.Is(err, syscall.Errno(33)) {
		if !quit {
			return browser(root, "open")
		}
		if _, err := command(root, "quit"); err != nil {
			return err
		}
		for until := time.Now().Add(25 * time.Second); time.Now().Before(until); {
			lock, err = acquire(root)
			if err == nil {
				return lock.Close()
			}
			if !errors.Is(err, syscall.Errno(33)) {
				return err
			}
			time.Sleep(250 * time.Millisecond)
		}
		return errors.New("Close Prowess Studio before changing the installation.")
	}
	if err != nil {
		return err
	}
	defer lock.Close()
	if quit {
		return nil
	}

	for _, name := range []string{"control.json", "status.json"} {
		if err := os.Remove(filepath.Join(root, name)); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	access, release, err := postgresPath(root)
	if err != nil {
		return err
	}
	defer release()
	self, err := os.Executable()
	if err != nil {
		return err
	}
	stage := filepath.Join(filepath.Dir(self), "payload")
	node := filepath.Join(stage, "runtime", "node.exe")
	controller := filepath.Join(stage, "desktop", "controller.mjs")
	cmd := exec.Command(node, controller, stage, root, access)
	cmd.Dir = filepath.Dir(controller)
	systemRoot := os.Getenv("SystemRoot")
	cmd.Env = []string{"SystemRoot=" + systemRoot, "WINDIR=" + systemRoot, "PATH=" + filepath.Join(systemRoot, "System32"),
		"TEMP=" + root, "TMP=" + root}
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x08000000}
	log, err := os.OpenFile(filepath.Join(root, "launcher.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	defer log.Close()
	cmd.Stdout, cmd.Stderr = log, log
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	defer stdin.Close()
	if err := cmd.Start(); err != nil {
		return err
	}
	job, err := jobFor(cmd.Process.Pid)
	if err != nil {
		cmd.Process.Kill()
		cmd.Wait()
		return err
	}
	defer syscall.CloseHandle(job)
	done := make(chan error, 1)
	go func() { done <- cmd.Wait() }()
	if _, err := io.WriteString(stdin, "START\n"); err != nil {
		return err
	}
	return showWindow(root, stdin, done)
}

func main() {
	if len(os.Args) > 1 && (os.Args[1] == "--extract" || os.Args[1] == "--remove-payloads") {
		self, err := os.Executable()
		if err == nil {
			directory := filepath.Dir(self)
			if os.Args[1] == "--extract" && len(os.Args) == 3 && strings.HasSuffix(directory, ".pending") {
				err = extractPayload(directory, os.Args[2])
			} else if os.Args[1] == "--remove-payloads" && len(os.Args) == 2 && filepath.Base(filepath.Dir(directory)) == "versions" {
				err = removePayloads(filepath.Dir(directory))
			} else {
				err = errors.New("invalid installer command")
			}
		}
		if err != nil {
			os.Exit(1)
		}
		return
	}
	if err := run(); err != nil {
		fail(fmt.Sprintf("Prowess Studio could not finish this operation.\n\n%s", err))
		os.Exit(1)
	}
}
