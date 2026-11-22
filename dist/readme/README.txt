RUMOR VILLAGE
=============

A rumor game: you drop a rumor into a village of neighbors and watch it spread
from mouth to mouth. It is played in the browser, on your computer, with no
accounts.

OPENING IT
- Windows: double-click rumor-village.exe. If "Windows protected your PC"
  appears, click "More info" and then "Run anyway" (the program is not
  signed). The black window that opens is the game: closing it closes the
  game.
- Linux: the game is the .AppImage file. Allow it to run (Properties >
  "Allow executing file as program", or chmod +x) and double-click it. A
  terminal opens, which is the game: closing it closes the game. If nothing
  happens, in a terminal:  ./rumor-village-linux-*.AppImage
  Without FUSE:  ./rumor-village-linux-*.AppImage --appimage-extract-and-run
The browser opens on the game. To quit: "Close the game" in the menu.

THE FIRST TIME
The game opens at once. If your graphics card can run the AI, the game's AI
(5.34 GB) downloads inside the game while you play Without AI; the menu shows
the progress and, when it is done, press "Turn on With AI". If the download is
cut, it resumes where it was.

WITH AI AND WITHOUT AI
- With AI: an AI decides what each neighbor does. It needs a graphics card.
- Without AI: fixed rules decide. It works on any computer.
If the AI cannot run, the game starts Without AI and the window says why.

YOUR DATA (the model, your games and your progress)
- Windows: %LOCALAPPDATA%\RumorVillage\
- Linux:   ~/.local/share/rumor-village/  (or $XDG_DATA_HOME/rumor-village/)
To update, use the new version (the unpacked .zip or the .AppImage): your
data stays where it is.

UNINSTALLING
Delete this folder (on Linux, the .AppImage) and the folder of your data.

Full guide:
https://github.com/manuelgscom/rumor-village/blob/main/docs/guia-jugador.en.md

License: LICENSE (MIT). Third-party notices: THIRD_PARTY_NOTICES.txt and licenses/.
