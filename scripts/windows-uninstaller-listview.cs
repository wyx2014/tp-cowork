// Read the NSIS details list, including rows hidden by ShowUninstDetails nevershow.
using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.Runtime.InteropServices;
using System.Text;

public static class NativeUninstallDetails {
    private delegate bool Visitor(IntPtr window, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumWindows(Visitor visitor, IntPtr parameter);
    [DllImport("user32.dll")] private static extern bool EnumChildWindows(IntPtr window, Visitor visitor, IntPtr parameter);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(IntPtr window, StringBuilder name, int capacity);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wparam, IntPtr lparam, uint flags, uint timeout, out UIntPtr result);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr OpenProcess(uint access, bool inherit, uint process);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool IsWow64Process(IntPtr process, out bool wow64);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr VirtualAllocEx(IntPtr process, IntPtr address, UIntPtr size, uint allocation, uint protection);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool WriteProcessMemory(IntPtr process, IntPtr address, byte[] data, UIntPtr size, out UIntPtr written);
    [DllImport("kernel32.dll", SetLastError = true)] private static extern bool ReadProcessMemory(IntPtr process, IntPtr address, byte[] data, UIntPtr size, out UIntPtr read);
    [DllImport("kernel32.dll")] private static extern bool VirtualFreeEx(IntPtr process, IntPtr address, UIntPtr size, uint operation);
    [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);

    private static int Message(IntPtr window, uint message, IntPtr wparam, IntPtr lparam) {
        UIntPtr result;
        if (SendMessageTimeout(window, message, wparam, lparam, 2, 2000, out result) == IntPtr.Zero)
            throw new InvalidOperationException("NSIS detail control did not respond.");
        return unchecked((int)result.ToUInt64());
    }
    private static void Write(IntPtr process, IntPtr address, byte[] data) {
        UIntPtr written;
        if (!WriteProcessMemory(process, address, data, new UIntPtr((uint)data.Length), out written))
            throw new Win32Exception(Marshal.GetLastWin32Error());
    }
    private static void Pointer(byte[] data, int offset, IntPtr pointer, bool target32) {
        var bytes = target32 ? BitConverter.GetBytes(unchecked((uint)pointer.ToInt64())) : BitConverter.GetBytes(pointer.ToInt64());
        Array.Copy(bytes, 0, data, offset, bytes.Length);
    }
    public static string[] Read(uint processId) {
        var lists = new List<IntPtr>();
        EnumWindows((window, parameter) => {
            uint owner;
            GetWindowThreadProcessId(window, out owner);
            if (owner == processId) EnumChildWindows(window, (child, unused) => {
                var name = new StringBuilder(128);
                GetClassName(child, name, name.Capacity);
                if (name.ToString() == "SysListView32") lists.Add(child);
                return true;
            }, IntPtr.Zero);
            return true;
        }, IntPtr.Zero);
        var output = new List<string>();
        var process = OpenProcess(0x1038, false, processId);
        if (process == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
        IntPtr memory = IntPtr.Zero;
        try {
            bool target32;
            if (!IsWow64Process(process, out target32)) throw new Win32Exception(Marshal.GetLastWin32Error());
            memory = VirtualAllocEx(process, IntPtr.Zero, new UIntPtr(8192), 0x3000, 4);
            if (memory == IntPtr.Zero) throw new Win32Exception(Marshal.GetLastWin32Error());
            foreach (var list in lists) {
                int count = Message(list, 0x1004, IntPtr.Zero, IntPtr.Zero);
                output.Add("NSIS detail rows: " + count);
                var prefix = IntPtr.Add(memory, 512);
                Write(process, prefix, Encoding.Unicode.GetBytes("File is busy, aborting:\0"));
                var find = new byte[128];
                Array.Copy(BitConverter.GetBytes(10), 0, find, 0, 4);
                Pointer(find, target32 ? 4 : 8, prefix, target32);
                Write(process, memory, find);
                int index = Message(list, 0x1053, new IntPtr(-1), memory);
                if (index < 0) continue;
                var text = IntPtr.Add(memory, 1024);
                var item = new byte[128];
                Pointer(item, target32 ? 20 : 24, text, target32);
                Array.Copy(BitConverter.GetBytes(2048), 0, item, target32 ? 24 : 32, 4);
                Write(process, memory, item);
                Message(list, 0x1073, new IntPtr(index), memory);
                var bytes = new byte[4096];
                UIntPtr read;
                if (!ReadProcessMemory(process, text, bytes, new UIntPtr((uint)bytes.Length), out read))
                    throw new Win32Exception(Marshal.GetLastWin32Error());
                output.Add(Encoding.Unicode.GetString(bytes).TrimEnd('\0'));
            }
        } finally {
            if (memory != IntPtr.Zero) VirtualFreeEx(process, memory, UIntPtr.Zero, 0x8000);
            CloseHandle(process);
        }
        return output.ToArray();
    }
}
