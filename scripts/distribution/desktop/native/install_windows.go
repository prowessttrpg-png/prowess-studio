//go:build windows

package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

func extractPayload(directory, expected string) error {
	archive := filepath.Join(directory, "payload.zip")
	file, err := os.Open(archive)
	if err != nil {
		return err
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return err
	}
	hash := sha256.New()
	if _, err := io.Copy(hash, file); err != nil {
		return err
	}
	if hex.EncodeToString(hash.Sum(nil)) != expected {
		return errors.New("installer payload checksum differs")
	}
	pack, err := zip.NewReader(file, info.Size())
	if err != nil {
		return err
	}
	destination := filepath.Join(directory, "payload")
	if err := os.RemoveAll(destination); err != nil {
		return err
	}
	if err := os.Mkdir(destination, 0700); err != nil {
		return err
	}
	for _, entry := range pack.File {
		name := strings.TrimSuffix(strings.TrimPrefix(entry.Name, "./"), "/")
		if (name == "" || name == ".") && entry.FileInfo().IsDir() {
			continue
		}
		relative := filepath.FromSlash(name)
		if !fs.ValidPath(name) || !filepath.IsLocal(relative) || strings.ContainsAny(name, "\\:") {
			return errors.New("installer payload contains an invalid path")
		}
		target := filepath.Join(destination, relative)
		if entry.FileInfo().IsDir() {
			if err := os.MkdirAll(target, 0700); err != nil {
				return err
			}
		} else if entry.Mode().IsRegular() {
			if err := os.MkdirAll(filepath.Dir(target), 0700); err != nil {
				return err
			}
			if err := extractFile(entry, target); err != nil {
				return err
			}
		} else {
			return errors.New("installer payload contains an unsupported file")
		}
	}
	return nil
}

func extractFile(entry *zip.File, target string) error {
	input, err := entry.Open()
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(target, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0600)
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(output, input)
	closeErr := output.Close()
	return errors.Join(copyErr, closeErr)
}

func removePayloads(versions string) error {
	entries, err := os.ReadDir(versions)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() {
			if err := os.RemoveAll(filepath.Join(versions, entry.Name(), "payload")); err != nil {
				return err
			}
		}
	}
	return nil
}
