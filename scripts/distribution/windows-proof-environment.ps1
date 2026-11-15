$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

if (-not ('ProwessProofHost' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Security.Principal;

public static class ProwessProofHost
{
    private const uint ProcessQueryLimitedInformation = 0x1000;
    private const uint TokenQuery = 0x0008;
    private const uint TokenDuplicate = 0x0002;
    private const int TokenElevationType = 18;
    private const int TokenElevation = 20;

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern IntPtr OpenProcess(uint access, bool inheritHandle, int processId);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);

    [DllImport("advapi32.dll", SetLastError = true)]
    private static extern bool GetTokenInformation(IntPtr token, int informationClass, out uint value, int size, out int returnedSize);

    [DllImport("kernel32.dll", SetLastError = true)]
    private static extern bool IsWow64Process2(IntPtr process, out ushort processMachine, out ushort nativeMachine);

    [DllImport("kernel32.dll")]
    private static extern bool CloseHandle(IntPtr handle);

    private static uint ReadTokenValue(IntPtr token, int informationClass)
    {
        uint value;
        int size;
        if (!GetTokenInformation(token, informationClass, out value, sizeof(uint), out size))
            throw new Win32Exception(Marshal.GetLastWin32Error());
        if (size != sizeof(uint))
            throw new InvalidOperationException("Unexpected token information size.");
        return value;
    }

    public sealed class ProcessDetails
    {
        public bool IsElevated;
        public bool IsAdministrator;
        public uint ElevationType;
        public ushort NativeMachine;
        public ushort ProcessMachine;
    }

    public static ProcessDetails Read(int processId)
    {
        IntPtr process = OpenProcess(ProcessQueryLimitedInformation, false, processId);
        if (process == IntPtr.Zero)
            throw new Win32Exception(Marshal.GetLastWin32Error());
        try
        {
            ProcessDetails result = new ProcessDetails();
            if (!IsWow64Process2(process, out result.ProcessMachine, out result.NativeMachine))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            IntPtr token;
            // WindowsPrincipal can duplicate a primary token to check its effective role.
            if (!OpenProcessToken(process, TokenQuery | TokenDuplicate, out token))
                throw new Win32Exception(Marshal.GetLastWin32Error());
            try
            {
                result.IsElevated = ReadTokenValue(token, TokenElevation) != 0;
                result.ElevationType = ReadTokenValue(token, TokenElevationType);
                using (WindowsIdentity identity = new WindowsIdentity(token))
                    result.IsAdministrator = new WindowsPrincipal(identity).IsInRole(WindowsBuiltInRole.Administrator);
                return result;
            }
            finally { CloseHandle(token); }
        }
        finally { CloseHandle(process); }
    }
}
'@
}

$hostOS = Get-CimInstance -ClassName Win32_OperatingSystem -Property Caption, Version, BuildNumber, ProductType
$details = [ProwessProofHost]::Read($targetProcessId)
[PSCustomObject]@{
    processId = [int]$targetProcessId
    caption = [string]$hostOS.Caption
    version = [string]$hostOS.Version
    build = [int]$hostOS.BuildNumber
    productType = [int]$hostOS.ProductType
    nativeMachine = [int]$details.NativeMachine
    processMachine = [int]$details.ProcessMachine
    isElevated = [bool]$details.IsElevated
    isAdministrator = [bool]$details.IsAdministrator
    elevationType = [int]$details.ElevationType
} | ConvertTo-Json -Compress
