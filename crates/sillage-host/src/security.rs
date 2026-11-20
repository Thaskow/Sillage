use std::ffi::c_void;
use std::io;
use std::os::windows::io::AsRawHandle;
use std::ptr::null_mut;

use windows_sys::Win32::Foundation::{CloseHandle, LocalFree, HANDLE};
use windows_sys::Win32::Security::Authorization::{
    ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW, GetSecurityInfo,
    SDDL_REVISION_1, SE_KERNEL_OBJECT,
};
use windows_sys::Win32::Security::{
    EqualSid, GetTokenInformation, TokenUser, OWNER_SECURITY_INFORMATION, PSECURITY_DESCRIPTOR,
    PSID, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER,
};
use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

struct UserSid {
    buf: Vec<u64>,
}

impl UserSid {
    fn current() -> io::Result<Self> {
        unsafe {
            let mut token: HANDLE = null_mut();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
                return Err(io::Error::last_os_error());
            }
            let mut len = 0u32;
            GetTokenInformation(token, TokenUser, null_mut(), 0, &mut len);
            let mut buf = vec![0u64; (len as usize).div_ceil(8).max(1)];
            let ok = GetTokenInformation(
                token,
                TokenUser,
                buf.as_mut_ptr().cast(),
                (buf.len() * 8) as u32,
                &mut len,
            );
            let err = io::Error::last_os_error();
            CloseHandle(token);
            if ok == 0 {
                return Err(err);
            }
            Ok(Self { buf })
        }
    }

    fn psid(&self) -> PSID {
        unsafe { (*(self.buf.as_ptr() as *const TOKEN_USER)).User.Sid }
    }

    fn to_string(&self) -> io::Result<String> {
        unsafe {
            let mut w: *mut u16 = null_mut();
            if ConvertSidToStringSidW(self.psid(), &mut w) == 0 {
                return Err(io::Error::last_os_error());
            }
            let mut n = 0;
            while *w.add(n) != 0 {
                n += 1;
            }
            let s = String::from_utf16_lossy(std::slice::from_raw_parts(w, n));
            LocalFree(w.cast());
            Ok(s)
        }
    }
}

pub fn current_user_sid() -> io::Result<String> {
    UserSid::current()?.to_string()
}

pub fn pipe_sddl(sid: &str) -> String {
    format!("O:{sid}G:{sid}D:P(A;;GA;;;{sid})")
}

pub struct PipeSecurity {
    sd: PSECURITY_DESCRIPTOR,
    sa: SECURITY_ATTRIBUTES,
}

unsafe impl Send for PipeSecurity {}
unsafe impl Sync for PipeSecurity {}

impl PipeSecurity {
    pub fn current_user() -> io::Result<Box<Self>> {
        let sddl: Vec<u16> = pipe_sddl(&current_user_sid()?)
            .encode_utf16()
            .chain(Some(0))
            .collect();
        let mut sd: PSECURITY_DESCRIPTOR = null_mut();
        let ok = unsafe {
            ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                SDDL_REVISION_1,
                &mut sd,
                null_mut(),
            )
        };
        if ok == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok(Box::new(Self {
            sd,
            sa: SECURITY_ATTRIBUTES {
                nLength: std::mem::size_of::<SECURITY_ATTRIBUTES>() as u32,
                lpSecurityDescriptor: sd,
                bInheritHandle: 0,
            },
        }))
    }

    pub fn as_ptr(&self) -> *mut c_void {
        &self.sa as *const SECURITY_ATTRIBUTES as *mut c_void
    }
}

impl Drop for PipeSecurity {
    fn drop(&mut self) {
        unsafe {
            LocalFree(self.sd);
        }
    }
}

/// Guards against another account squatting the pipe name before our host.
pub fn owned_by_current_user(object: &impl AsRawHandle) -> io::Result<bool> {
    let handle = object.as_raw_handle() as HANDLE;
    let me = UserSid::current()?;
    unsafe {
        let mut owner: PSID = null_mut();
        let mut sd: PSECURITY_DESCRIPTOR = null_mut();
        let rc = GetSecurityInfo(
            handle,
            SE_KERNEL_OBJECT,
            OWNER_SECURITY_INFORMATION,
            &mut owner,
            null_mut(),
            null_mut(),
            null_mut(),
            &mut sd,
        );
        if rc != 0 {
            return Err(io::Error::from_raw_os_error(rc as i32));
        }
        let same = !owner.is_null() && EqualSid(owner, me.psid()) != 0;
        LocalFree(sd);
        Ok(same)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sid_and_descriptor_are_built() {
        let sid = current_user_sid().unwrap();
        assert!(sid.starts_with("S-1-"), "{sid}");
        assert_eq!(
            pipe_sddl("S-1-5-21-1"),
            "O:S-1-5-21-1G:S-1-5-21-1D:P(A;;GA;;;S-1-5-21-1)"
        );
        let s = PipeSecurity::current_user().unwrap();
        assert!(!s.as_ptr().is_null());
    }

    #[test]
    fn pipe_gets_owner_and_protected_dacl() {
        use windows_sys::Win32::Security::Authorization::ConvertSecurityDescriptorToStringSecurityDescriptorW;
        use windows_sys::Win32::Security::DACL_SECURITY_INFORMATION;

        let name = format!(r"\\.\pipe\sillage-acl-{}", std::process::id());
        let sec = PipeSecurity::current_user().unwrap();
        let rt = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
            .unwrap();
        let _guard = rt.enter();
        let pipe = unsafe {
            tokio::net::windows::named_pipe::ServerOptions::new()
                .first_pipe_instance(true)
                .create_with_security_attributes_raw(&name, sec.as_ptr())
        }
        .unwrap();
        assert!(owned_by_current_user(&pipe).unwrap());
        let sddl = unsafe {
            let mut sd: PSECURITY_DESCRIPTOR = null_mut();
            let rc = GetSecurityInfo(
                pipe.as_raw_handle() as HANDLE,
                SE_KERNEL_OBJECT,
                DACL_SECURITY_INFORMATION,
                null_mut(),
                null_mut(),
                null_mut(),
                null_mut(),
                &mut sd,
            );
            assert_eq!(rc, 0);
            let mut w: *mut u16 = null_mut();
            let ok = ConvertSecurityDescriptorToStringSecurityDescriptorW(
                sd,
                SDDL_REVISION_1,
                DACL_SECURITY_INFORMATION,
                &mut w,
                null_mut(),
            );
            assert_ne!(ok, 0);
            let mut n = 0;
            while *w.add(n) != 0 {
                n += 1;
            }
            let s = String::from_utf16_lossy(std::slice::from_raw_parts(w, n));
            LocalFree(w.cast());
            LocalFree(sd);
            s
        };
        let sid = current_user_sid().unwrap();
        assert_eq!(sddl, format!("D:P(A;;FA;;;{sid})"));
    }
}
