# Jawbs local mode: macOS checklist

This is for you to work through on a Mac, since everything so far has been checked on Linux only. Tick each box as you go, and note anything that looks odd, however small. Where something fails, copy the exact message.

## What was already checked on Linux

Jawbs starts from the launcher, shows the Getting started chat, Claude's first turn arrives, a PDF attaches into `core/source/`, and Quit Jawbs closes the port. The steps below cover what only a Mac can tell us.

## 1. Fresh start

- [ ] Clone the kit into a new folder: `git clone <repo address> jawbs-test` and `cd jawbs-test`.
- [ ] Run `./setup/setup.sh`. Answer the questions, and choose option 1 (in your web browser, on this computer).

## 2. Missing tools (do these only if they apply, or by temporarily renaming things)

- [ ] With Node missing: the wizard should say Jawbs needs Node 18 or newer and point you to nodejs.org, then finish without an error. After installing Node, run `setup/jawbs-local.sh <your project folder>` and check it carries on from there.
- [ ] With Claude Code missing: the wizard should say so and explain how to install and sign in. Then re-run `setup/jawbs-local.sh <your project folder>` as above.
- [ ] Typst: if it is not installed, the wizard should offer to install it. Say yes once and check it works (`typst --version`).

## 3. The app and its icon (Mac-only, untested so far)

- [ ] `Jawbs.app` exists in `~/Applications` and shows the Jawbs icon, not a blank one. This depends on `sips` and `iconutil` building the icon from `setup/assets/jawbs.png`. If the icon is blank, check that `~/Applications/Jawbs.app/Contents/Resources/jawbs.icns` exists.
- [ ] There is a Jawbs item on the Desktop. It should be a Finder alias with the Jawbs icon. If it is a plain arrow-shortcut, the alias step fell back to a symlink; note which you got.
- [ ] Check the property list is valid: `plutil -lint ~/Applications/Jawbs.app/Contents/Info.plist` should print `OK`.
- [ ] Double-click Jawbs on the Desktop. Your browser should open on the Jawbs page and **no Terminal window** should appear. A brief Dock bounce is fine.
- [ ] Double-click it a second time. It should simply reopen or focus the page, without starting a second copy.
- [ ] If macOS says the app cannot be opened because it is from an unidentified developer, right-click it, choose Open, and note that this happened.

## 4. Browsers

No sign-in is involved, so the secure-cookie worry does not apply. Just check the page loads.

- [ ] Safari: `http://localhost:8710` loads the Getting started chat.
- [ ] Chrome: the same.
- [ ] Firefox: the same.

## 5. Getting started

- [ ] The first message from Jawbs arrives (give it a minute).
- [ ] Use the paperclip button to attach your CV (a PDF or Word file). The reply box fills in a line mentioning `core/source/`, and the file appears in your project's `core/source/` folder.
- [ ] Send the reply and check Jawbs answers.
- [ ] Carry on through the conversation until you reach the test CV render (session C). It should produce a PDF you can download from the chat, and the PDF should open and look right.

## 6. Quit and restart

- [ ] Click Quit Jawbs and confirm. The page says it is closing. Then check the port is free: `lsof -i :8710` should print nothing.
- [ ] Double-click Jawbs again. It should start afresh and reopen the page, with your earlier chat still there.
- [ ] `portal/data/jawbs.log` exists in the kit folder and shows the start and quit lines.

## If something fails

Write down the step number, what you saw, and the last few lines of `portal/data/jawbs.log`. Do not fix it on the spot; send it back and we will sort it out together.
