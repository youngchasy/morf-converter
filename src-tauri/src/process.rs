use std::{path::Path, process::Command};

/// Creates a child process that never opens a separate console window.
///
/// On macOS and Linux GUI applications do not get a new terminal for child
/// processes. Windows console programs do, unless CREATE_NO_WINDOW is used.
pub fn background_command(executable: impl AsRef<Path>) -> Command {
    let mut command = Command::new(executable.as_ref());

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    command
}
