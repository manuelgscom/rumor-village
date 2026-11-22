# Player guide

Versión en castellano: guia-jugador.md

> **Status:** describes version 1.0.0 of the game: the downloaded packages for Linux and Windows and the web version. The game works **offline, no accounts**; it only connects once, to download the AI (5.34 GB) from Hugging Face.

Rumor Village is a rumor game. You have a village of neighbors who walk around, chat and tell each other things. You drop a rumor and watch it run from mouth to mouth, how it gets twisted along the way and who ends up in the square at the wrong time.

This guide is the short version of the game design, for playing.

## Installing and opening

It is played in the browser of a computer: there is no mobile version, although the screen adapts if the window is narrow or touch-based.

### With the downloaded package

You download a file and open the program: on Windows a `.zip` that you unpack, and on Linux an AppImage, a single file that opens as it is. There is no installer. You download it from the [latest release page](https://github.com/manuelgscom/rumor-village/releases/latest) on GitHub.

```
 pick the package ──► check the sum ──► prepare ─────────────────────► double-click
   (your system and      (optional)     Windows: unzip                     │
    your card)                          Linux: allow it to run             │
                                                                           ▼
                                 a window says what it found: graphics card, driver
                                                                           │
                                           the browser opens with the game, at once
                                                                           │
                    ┌──────────── can it run the AI? ──────────────────────┤
                    │ yes                                                  │ no
                    ▼                                                      ▼
     is the AI there yet (5.34 GB)? ── yes ──► you play With AI   you play Without AI
                    │ no                                          (the menu says why)
                    ▼
     you play Without AI while it downloads, with the progress in the menu
                    │
     "Turn on With AI" ──► the game reloads With AI
```

#### Which package to download

There are four, for Linux and Windows. **There is no Mac version.**

| Your computer | Package |
|---|---|
| Windows with an NVIDIA card | `rumor-village-windows-cuda-1.0.0.zip` |
| Windows with an AMD or Intel card, or with an old NVIDIA driver | `rumor-village-windows-vulkan-1.0.0.zip` |
| Linux with an NVIDIA card | `rumor-village-linux-cuda-1.0.0.AppImage` |
| Linux with an AMD or Intel card, or with an old NVIDIA driver | `rumor-village-linux-vulkan-1.0.0.AppImage` |

- **CUDA is only for NVIDIA, and on NVIDIA it is faster.** Vulkan works with NVIDIA, AMD and Intel, but with many neighbors at once it runs at half the speed of CUDA (measured with an RTX 5070 Ti). On AMD and Intel the speed is "not verified".
- **The CUDA one needs a recent NVIDIA driver:** 525.60.13 or later on Linux and 528.33 or later on Windows. With an older one, update it or use the Vulkan one.
- **The CUDA ones are much bigger,** because they carry the NVIDIA libraries: about 630 MB on Linux and 670 MB on Windows, against 15 and 18 MB for the Vulkan ones.
- **Without a graphics card any of them will do:** all four play Without AI. But to play only Without AI you do not need to download anything: there is the [web version](#the-web-version-without-ai).
- **Windows:** tested on Windows 11; Windows 10, "not verified".
- **Linux:** it needs glibc 2.34 or later: Ubuntu 22.04 or later, Debian 12 or later, a recent Fedora, RHEL or AlmaLinux 9 or later. Tested on those distributions without a graphics card (Without AI).

#### Checking the download (optional)

Next to the packages there is the file `SHA256SUMS`, with the checksum of each one. If your checksum matches, the file arrived whole.

- **Linux,** in the folder where the package and `SHA256SUMS` are:

  ```
  sha256sum -c SHA256SUMS --ignore-missing
  ```

  It must say `OK` next to your package.
- **Windows,** in a "Command Prompt" window in that folder:

  ```
  certutil -hashfile rumor-village-windows-cuda-1.0.0.zip SHA256
  ```

  Compare the number it prints with the one for your package in `SHA256SUMS`.

#### Opening

On Windows, unpack the `.zip` wherever you like (the Desktop or your home folder). You get a folder with this (on Linux it holds the same, but inside the AppImage):

| What | What for |
|---|---|
| `rumor-village` (`rumor-village.exe` on Windows) | The program you open |
| `lib/` (Linux) or the `.dll` files (Windows) | The libraries it needs |
| `viewer/` and `data/` | The game and the village |
| `model.json` | Which model to download and how to check it |
| `LEEME.txt`, `README.txt` | These instructions, in short |
| `LICENSE`, `THIRD_PARTY_NOTICES.txt`, `licenses/` | The game's license (MIT) and the third-party notices |

**On Windows,** double-click `rumor-village.exe`. The program is not signed, so the first time Windows warns you:

1. "Windows protected your PC" appears. Click **"More info"**.
2. The **"Run anyway"** button appears. Click it.

A black window (the console) opens and says what it found, and then the browser opens with the game. That window is the game: **if you close it, the game closes.** When you quit the game, it closes by itself. If something fails at startup, the window waits for you to press Enter so you can read the error.

**On Linux,** the game is a single file, the AppImage:

1. **Allow it to run.** When you download it, the browser takes that permission away. In the file manager: right click → Properties → "Allow executing file as program" (the name changes a little from one desktop to another). Or in a terminal: `chmod +x rumor-village-linux-*.AppImage`.
2. **Double-click it.** A terminal window opens and says what it found and, then, the browser opens with the game. That window is the game: **if you close it, the game closes.** When you quit the game it closes by itself, and if something fails it waits for you to press Enter so you can read the error. If your desktop has no known terminal, the game opens in the browser all the same, but without that window.

- **If double-clicking does nothing** (it depends on the file manager; "not verified" on each one), open it from a terminal in its folder: `./rumor-village-linux-cuda-1.0.0.AppImage` (or the Vulkan one).
- **If it says something about FUSE** ("fusermount", "cannot mount"): the AppImage is mounted with FUSE, which almost every desktop distribution ships (the `fuse3` package). Without it, open it like this: `./rumor-village-linux-cuda-1.0.0.AppImage --appimage-extract-and-run`. The old `libfuse2` is not needed.
- **To have it in the applications menu,** tools like Gear Lever or AppImageLauncher integrate it; the game does not install anything by itself.

To open the browser it uses `xdg-open`; if it cannot, it prints the game's address for you to copy.

#### The first launch

1. **The launcher looks at your computer:** which package it is, whether there is an NVIDIA card and its driver, whether there is Vulkan and which graphics card can run the AI.
2. **It starts the game and opens the browser at once** (at `http://127.0.0.1:8080/?play=1`, or on another port if that one is taken). If the AI is already on your computer, you play With AI.
3. **If With AI is possible but the game's AI (5.34 GB) is missing, it downloads inside the game.** Meanwhile you play Without AI, and the card in the menu shows the progress: "Downloading the AI: 37% (2.0 of 5.3 GB)". When it finishes, it checks the whole file ("Checking the AI…") and the **"Turn on With AI"** button appears: the game restarts for a few seconds and comes back With AI. From then on, every time you open it, it is With AI straight away.
   - If the download is cut off, if you close the game halfway or if there is no room on the disk, the menu says so and offers **"Download the AI (5.3 GB)"**. What was downloaded is not lost: it resumes where it was.
   - If the file arrives damaged, it is deleted and downloaded again.

- **Where the AI is downloaded from:** [Hugging Face](https://huggingface.co/manuelgscom/rumor-village-e4b-GGUF), and the game downloads it by itself. If your computer has no connection, you can put it in place by hand: the file `gemma-4-E4B-it-rumor-Q4_K_M.gguf` in the `models/` folder of your data. When you open the game again, it finds it.
- **After the download, nothing leaves your computer:** offline, no accounts. There are no online checks either.
- **If you open it while the game is already open,** it does not start another one: it opens another tab with the same game.

An example of what the window says the first time, with an NVIDIA card and without the AI yet:

```
Rumor Village 1.0.0
Data folder: /home/<user>/.local/share/rumor-village
Build: CUDA
NVIDIA: NVIDIA GeForce RTX 5070 Ti, driver for CUDA 12.9
Graphics card: NVIDIA GeForce RTX 5070 Ti (CUDA0)
The AI model (5.34 GB) is missing: it downloads inside the game while you play Without AI, and the game turns it on.
Mode: Without AI
The game is at http://127.0.0.1:8080/?play=1
To finish, press «Close the game» in the menu or Ctrl+C here.
```

When you press "Turn on With AI" it adds "Loading the AI…", "Mode: With AI" and "The game goes on at http://127.0.0.1:8080/?play=1". While it cannot be downloaded from the game (until the AI is published), instead of the download line it says "The model is missing" and where to put the file.

The window speaks Spanish if your system is in Spanish, and English otherwise. All the messages, with what to do in each case, are in [Launcher messages](#launcher-messages).

#### Closing

"Close the game" in the menu (it asks for confirmation) closes the program. Ctrl+C in the window, or closing it, also works.

#### Options

With no options, the program does what is described above. From a terminal in the game's folder (on Linux, `./rumor-village-linux-cuda-1.0.0.AppImage` or the Vulkan one; on Windows, `.\rumor-village.exe`):

| Option | What it does |
|---|---|
| `--data-dir <folder>` | Uses another data folder ([Where everything is saved](#where-everything-is-saved)) |
| `--no-browser` | Does not open the browser: it only prints the game's address |
| `--port <N>` | The port it tries first (8080 if not given); if it is taken, it uses another one |
| `--model-url <address>` | Downloads the model from that address instead of the one in `model.json` |
| `--version` | Prints the version and exits |
| `--help` | Prints these options and exits |

For example: `./rumor-village-linux-cuda-1.0.0.AppImage --data-dir /media/disk/rumor-village`.

#### Updating to a new version

On Windows, unpack the new version into another folder (or over the old one) and open it; on Linux, download the new AppImage, allow it to run and open it. The data folder is the same: you lose neither games nor progress, and the model is not downloaded again. You can delete the old folder, or the old AppImage. The same goes for switching from the CUDA package to the Vulkan one, or the other way round: they share the model and the progress.

#### Uninstalling

Delete the game's folder (on Linux, the AppImage file) and the data folder ([Where everything is saved](#where-everything-is-saved)). Nothing else is left: the game does not touch the Windows registry or install anything on the system.

### The web version "Without AI"

The same game, in the browser, without downloading anything. It is not published yet.

- **It only plays Without AI.** When you choose With AI, or at the end of the game, it offers you "Download it to play With AI": With AI is played with the downloaded package, on your computer.
- **Your progress lives in that browser.** "My games" and your profile (stars and tutorial seen) are saved in that browser, on that computer. **If you clear the browser's data, they are lost,** and they do not move to another browser or to the downloaded game. In a private window, or with site data blocked, you play the same, but the progress is lost when you close it.
- **Challenging a friend works between the web and the downloaded game:** a game Without AI comes out identical in both, so a challenge code can be played in either.

### From the repository

You need Docker. In the repo folder:

```
./play.sh            # opens the browser with the village standing still
./play.sh --no-ai    # play Without AI, without a graphics card
```

- **To play With AI** you need an NVIDIA card that works in Docker and the model `models/gemma-4-E4B-it-rumor-Q4_K_M.gguf`. If something is missing, `play.sh` does not stop: it starts Without AI and tells you why.
- **To close it,** "Close the game" in the menu (it asks for confirmation) or Ctrl-C in the terminal.

## Your first game

When you open the game you will see the menu with a big card, **"Tutorial"**. It has two parts:

1. **"How it works":** eight short cards that explain the game before you touch anything. You will meet the six characters through one neighbor of each (those six are in every village; the other neighbors also have one of the six characters), and you will see how the rumor runs (only when two of them meet and chat). You will also see what the AI does, how people go where the rumor says, how it gets twisted along the way, what your goal is and how to read the village. You can go back and forward, or skip them.
2. **"Your first game":** a guided game of 7 steps in a village of 25 neighbors (in your own games you can choose from 10 to 100), until one in the afternoon. A card tells you what to do and points at the control to use:

| Step | What you do |
|---|---|
| What happened? | Pick one of the 7 news items, or press "Use this example". With AI, you can also write it in your own words and press "Fill in the sentence" |
| Who do you tell? | Choose whom you tell by looking at their card: their character, their family and friends, and where they spend the day |
| Start | Press the start button. From then on, you only watch |
| Watch it run | Watch the counter of neighbors who heard about it and the speech bubbles (With AI, the AI writes them right then) |
| Someone has heard | See who told whom, at what time, and whether it reached them intact, incomplete or distorted |
| What did they think? | Press "See what they decided" and read what that neighbor decided |
| What about another neighbor? | See how many it reached and press "Try another neighbor": same village and same rumor, with another person |

"Show me" takes the keyboard to the control to use. The ✕ only folds the card: the "Guide" pill opens it again. To leave it for good, "Go on without the guide". It gives no stars. "How to play", at the foot of the menu, opens only the explanation again.

## A game, from start to finish

```
 open ──► menu ──► prepare ──► [Start] ──► the village runs ──► end
           │       the rumor,              you only watch;      your score, who moved it,
           │       whom,                   "End now"            where it stopped, stars,
           │       when                    whenever you like    Who did it?
           │                     "Try another neighbor" ◄────────┤ (same rumor, another person)
           │                            "Repeat the same" ◄──────┤ (same rumors)
           └── Tutorial · Free game · Challenges · "Back to the menu" ◄───┘
               Friend’s challenge · My games
```

1. **When you open it, nothing happens.** The village stands still ("Waiting for you to start") and nobody knows anything.
2. **In the menu** you choose the tutorial, "Free game", a challenge, a friend's challenge or your previous games.
3. **You prepare the game.** At the top you see the goal, from what time to what time the game runs and how long it lasts. The free game opens with a "Rumor ready", and the map marks who will know it first and where what the rumor tells happens. You can start with a single button ("Tell Ana and start"), change whom you tell or edit the rumor. Under "More options" there are more rumors, the race, the bets and the settings:
   - **The neighbors:** who decides, the character of the village (from "mostly discreet" to "mostly gossips": how many gossips there are among the neighbors; the six regulars do not change), the distortion (little, normal or a lot) and the language.
   - **The game:** in the village or in a row, which is the broken telephone with twenty neighbors; 10, 25, 50, 70 or 100 neighbors (with more than 25 the game lasts longer); and the village no., which is the village's code, not its size.
4. **You start.** The clock begins to run and you only watch. The stretches where nothing happens are skipped by themselves, and the village pauses for a moment so you can read what is new.
5. **The end** comes when the day is over, at the time set by the challenge, or when you press "End now" and confirm it. You will see:
   - your score with its unit, the stars ("2 of 3 stars (With AI)") and how far you are from the next one, and the comparison with your previous attempt;
   - **who moved it**, the ones who told it the most;
   - **where it stopped**, who knew it and told nobody.

   The bets, "Who did it?", the summary of the day and "Share" are under "More details".

The same village no., with the same neighbors and the same character of the village, always gives the same village. Another number deals out jobs, characters, homes and friendships again: the names repeat, but the people change. The free game stays in the village of your last game, so that what you learn about its neighbors is useful to you; "Another village" changes it, and the game warns you that it is a new village. At the end, the card suggests whom to tell next time and why.

## With AI and Without AI

The whole game can be played in two ways. The only thing that changes is who decides what each neighbor does:

- **With AI (recommended).** Each neighbor is moved by an AI trained for this game, which runs on your computer, offline.
  - The neighbors talk with sentences of their own.
  - They think through every decision.
  - You can see what each one was thinking.
  - You can write the rumor in your own words.
  - It needs a graphics card, and repeating a game gives a similar one, not an identical one.
- **Without AI.** Fixed rules with dice decide. It is instant, it works on any computer and a repeated game comes out identical. The speech bubbles only state the facts (“party · square · 21:00”).

The "With AI and Without AI" screen, at the foot of the menu, shows a real exchange in both modes. The mode is always visible: in the menu, on a label during the game and on every score and every code.

**Changing the mode or the language.** In the menu: "Who decides", inside the mode card (if your computer can play With AI), and "Castellano / English", next to the title. They can also be changed when preparing the game, under "More options". The game remembers your last choice, also the next time you open it.

## The rumors

The rumor is written as a sentence with blanks: "A [party] at [the square], [today] at [12:00]", and if you like, "for [Manuel]" and "[40] people".

| Detail | What you can put |
|---|---|
| What happened | One of the 7 village news items: party, wedding, concert, building works, lottery prize, inheritance or fine |
| Whose | A neighbor, if you like |
| Where | A place in the village (the square, the church, the bar…), or none |
| When | Today or tomorrow, on the hour or at half past, or none |
| How much | A number ("40 people", "euros"), if you like |

- **With AI you can write it the way you would say it:** “tonight there is a party in the square at 9”. Press "Fill in the sentence" and the AI fills in the blanks. Then you can change any detail. If you write something that is not one of the 7 news items ("a fire"), it asks you to pick the closest one.
- **Where and when move people.** If the rumor says where and when, whoever hears it usually goes there at that time. With "tomorrow", nobody goes today and the game gets longer.
- **Whom you tell:** some specific neighbors (up to 3 in a free game), or a place, and then whoever is there at that moment hears it.
- **When you tell it:** "As soon as it starts (07:00)" or "Later, at…". It is the time the first one hears it, not the time in the rumor.
- **You can drop several rumors** in the same game. In the broken telephone row there is only one, and the first in the row gets it.

## The neighbors

Choosing whom you tell is the most important thing. Each neighbor has a card:

- **Their character.** A gossip tells it almost always; a sociable one, often; an exaggerator, often and sometimes exaggerates; a prudent one thinks it over; a shy one does not dare; and a discreet one almost never tells it.
- **Their family, their friends and their rivals.** They tell it mostly to family and friends; to a rival, almost never.
- **Where they live and where they spend the day.** The rumor only passes when two neighbors are at the same place, so those who are at busy places (the bar, the market) move it more. When you hover over a neighbor's card, the map marks their neighborhood and their place for the day.

## The bet and the race

Before starting, if you like, you bet on the first rumor. At the end you win up to 10 bet points per question, more the closer you get, apart from your score:

- How many neighbors will go to the place and at the time of the rumor?
- At what time will half the village know it?
- Who will be the last to hear about it?

**The race** is with two rumors. You choose the time of the count and bet on which one more neighbors will know at that time. In each chat a neighbor usually tells only one, so your rumors compete. The map paints each rumor in a different color.

## The challenges

Each challenge sets part of the game (always the village no.) and leaves the rest to you. **The stars** are targets: each challenge gives 0 to 3, one for each target you reach, and ★★★ is the most. With AI and Without AI have different targets and are kept apart. The list states each target ("Targets (Without AI): ★ with 6 · ★★ with 9 · ★★★ with 12 or more neighbors who heard about it") and your best result in each mode.

| Challenge | In one line |
|---|---|
| Fill the square | There is a party in the square: choose whom you tell so that many turn up at the right time |
| Patient zero | Tell a single neighbor and get as many as possible to hear about it |
| Against the clock | Get half the village to know it before the deadline |
| Broken telephone | Twenty in a row: get many to end up without the right time, and the time to arrive as changed as possible. With AI the neighbors forget the time more than they change it |
| Surprise party | Get many to come to the party without the guest of honor finding out |
| Tell the priest | Get the priest to know it before the deadline without telling him yourself |

In Surprise party the neighbors do not know it is a surprise: they tell it like any other rumor, so everything depends on whom you tell.

## What did they think?

Click a neighbor and you will see, in plain language, every decision they made:

- **With AI,** what the AI read, what it decided and whether the game accepted it.
- **Without AI,** the rule that was applied and the roll of the dice.

## Who did it?

At the end, before seeing how the rumor ran, you point at the neighbor you think was the first to tell it with some detail changed (forgetting it does not count). Then the chain is revealed hop by hop, with each change and its before and after, and you are told whether you got it right. If nobody told it distorted, the right answer is **"Nobody changed it"**.

## Challenge a friend

"Share" gives you a code (and a link that carries it; "Friend’s challenge" accepts both) with the village, the settings, the rumors, the bets, the mode and your score. Your friend pastes it into "Friend’s challenge", plays the same on their computer and sees both scores.

- **Only scores of the same mode and the same game version are compared.** If they do not match, it says so and they are not compared.
- **With AI the game comes out similar, not identical.** Without AI it comes out identical: an exact duel.

There is no server and there are no accounts: the code is all that travels.

## My games

The list of your games, with their date, type, mode, challenge and score. Each one opens with the timeline, to watch it again and rewind.

## Where everything is saved

Everything stays on your computer, in the **data folder**. It is separate from the game's folder, and that is why updating does not delete anything.

| How you play | Data folder |
|---|---|
| Downloaded package, Linux | `$XDG_DATA_HOME/rumor-village/`; if that variable does not exist, `~/.local/share/rumor-village/` |
| Downloaded package, Windows | `%LOCALAPPDATA%\RumorVillage\` (for example, `C:\Users\<user>\AppData\Local\RumorVillage\`) |
| From the repo (`./play.sh`) | `runs/play/` |
| Web version | In that browser (below) |

```
 <data folder>/
   models/gemma-4-E4B-it-rumor-Q4_K_M.gguf   the AI model (5.34 GB; ends in .part while downloading)
   <game>.jsonl                              the log of each game
   <game>.game.json                          the game data: challenge, bets, score
   <game>.cards.jsonl                        what each neighbor thought
   profile.json                              your progress: stars and tutorial seen
   instance.json                             only while the game is open: where it listens
```

In the repo there is no `models/` or `instance.json` there: the model goes in the repo's `models/`.

- **To change it,** open the game with `--data-dir <folder>` ([Options](#options)) or set the environment variable `RUMOR_DATA_DIR`; if both are set, the option wins. If you already had data, move its contents to the new folder (above all `models/`, so you do not download the model again).
- **To start from scratch,** delete `profile.json`. Your games stay in "My games".
- **The browser only keeps conveniences** in the downloaded game and in the repo: the rumor half edited when you change village, the view and the sound. If you clear them or play in a private window, you lose nothing of the game.
- **In the web version** it is the other way round: "My games" and your profile live in that browser's storage, and they are lost if you clear its data.

## Launcher messages

When With AI is not possible, the game starts Without AI and explains why in the launcher window (the console) and in the game, in the menu and when preparing the game. Everything about the AI download only appears in the game menu, with its button. The texts, word for word:

| Reason | In the window | In the game | What to do |
|---|---|---|---|
| No usable graphics card | "There is no graphics card that can run the AI. You play in Without AI mode." | "there is no graphics card that can run the AI" | Nothing: you play Without AI |
| CUDA package without NVIDIA | "This build is for NVIDIA cards and your computer has none. To play with AI, download the Vulkan one." | "this download is for NVIDIA cards and your computer has none; to play With AI, get the Vulkan one" | Download the Vulkan package |
| Old NVIDIA driver | "Your NVIDIA driver is older than the one needed. Update the driver or use the Vulkan build." | "your NVIDIA driver is too old; update it or use the Vulkan download" | Update the driver (525.60.13 on Linux, 528.33 on Windows, or later) or use the Vulkan one |
| No Vulkan | "Vulkan was not found. Update the driver of your graphics card." | "Vulkan was not found; update the driver of your graphics card" | Update the graphics card driver |
| No room for the AI | "5.34 GB of free space are needed in <data folder>/models." | "There is no room on the disk: 5.3 GB are needed in <folder>." | Free up space and press "Download the AI (5.3 GB)" in the menu, or use another data folder (`--data-dir`) |
| Download cut off | — | "The download was cut off." | Press "Download the AI (5.3 GB)": it resumes where it was |
| The AI arrived damaged | — | "The file arrived damaged and has been deleted." | Press "Download the AI (5.3 GB)" |
| No curl | — | "The program curl, which does the download, is missing." | Install curl (Linux; Windows 11, and Windows 10 from version 1803, already have it) and open the game again, or put the file in place by hand |
| The AI is missing and there is nowhere to get it yet | "The model is missing. To play with AI, put the file gemma-4-E4B-it-rumor-Q4_K_M.gguf in <data folder>/models." | "The game's AI cannot be downloaded from here yet.", with the file, the folder and "Copy the folder" | Put the file in that folder and open the game again. It shows with a package that does not know where to get it; the published ones should not show it |
| The model does not start | "The model did not start on your graphics card.", followed by the error | "the AI did not start on your graphics card" | Update the driver; if it persists, try the other package |
| Web version | — | "this is the web version, which plays Without AI" | Download the game to play With AI |

If your system is in Spanish, the window speaks Spanish instead.

Other messages from the window:

| Message | What it means |
|---|---|
| "Rumor Village is already open at http://127.0.0.1:…" | The game was already open: another tab opens with it and the program exits |
| "The AI model (5.34 GB) is missing: it downloads inside the game…" | The AI downloads in the background; the progress is in the game menu |
| "Loading the AI…", "Mode: With AI" and "The game goes on at …" | You pressed "Turn on With AI": the game restarts with the AI at the same address |
| "The port has changed: open … in the browser" | On restarting it could not use the same port: open the new address (the open page will not find it) |
| "Open it in your browser." | It could not open the browser: copy the address from the line above |
| "rumor-village: '…/viewer' is missing: unpack the whole archive again" (or `data`) | Part of the game is missing: on Windows, unpack the whole `.zip` again; on Linux, download the AppImage again |
