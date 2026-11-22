"""Pack a Windows prebuilt folder into a reproducible .zip (phase 10).

    python dist/package/archive.py <folder> <archive.zip>

The archive has one root folder, named like the folder. Members go in byte
order of their paths, with the time of SOURCE_DATE_EPOCH (the last commit, set
by assemble.sh) and mode 755 for executables and folders, 644 for the rest.
Symbolic links are an error. Prints the member names, one per line, for the
checks of assemble.sh. Runs in the tools image (scripts/tools.sh): standard
library only. (The Linux prebuilts are AppImages: assemble.sh makes them with
mksquashfs.)
"""

import os
import stat
import sys
import time
import zipfile


def members(folder):
    """Every path under folder (folders too), relative to its parent, sorted."""
    parent = os.path.dirname(os.path.abspath(folder))
    out = []
    for dirpath, dirnames, filenames in os.walk(folder):
        for name in dirnames + filenames:
            out.append(os.path.relpath(os.path.join(dirpath, name), parent))
    out.append(os.path.basename(os.path.abspath(folder)))
    return parent, sorted(out, key=lambda p: p.encode())


def mode_of(path):
    st = os.lstat(path)
    if stat.S_ISDIR(st.st_mode) or st.st_mode & 0o111:
        return 0o755
    return 0o644


def write_zip(folder, archive, epoch):
    parent, names = members(folder)
    when = time.gmtime(max(epoch, 315532800))[:6]  # zip dates start in 1980
    with zipfile.ZipFile(archive, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for name in names:
            path = os.path.join(parent, name)
            if os.path.islink(path):
                raise SystemExit(f"archive: symbolic link in a .zip: {name}")
            is_dir = os.path.isdir(path)
            arc = name.replace(os.sep, "/") + ("/" if is_dir else "")
            info = zipfile.ZipInfo(arc, date_time=when)
            info.create_system = 3  # unix, so that the mode below is read
            info.external_attr = ((stat.S_IFDIR if is_dir else stat.S_IFREG) | mode_of(path)) << 16
            if is_dir:
                info.external_attr |= 0x10  # MS-DOS directory flag
                z.writestr(info, b"")
            else:
                info.compress_type = zipfile.ZIP_DEFLATED
                with open(path, "rb") as f:
                    z.writestr(info, f.read())
    return names


def main(argv):
    if len(argv) != 3:
        raise SystemExit("usage: archive.py <folder> <archive.zip>")
    folder, archive = argv[1].rstrip("/"), argv[2]
    epoch = int(os.environ.get("SOURCE_DATE_EPOCH", "0"))
    if not archive.endswith(".zip"):
        raise SystemExit(f"archive: not a .zip: {archive}")
    names = write_zip(folder, archive, epoch)
    for name in names:
        print(name)


if __name__ == "__main__":
    main(sys.argv)
