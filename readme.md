# robust-reloader

An experimental chrome extension that lets you reload the current tab from the omnibar using simple commands.

## Usage

1. Hit [ctrl] + [l] or [cmd] + [l] to highlight the contents of the omnibar.
2. Type "r" into the omnibar and hit [tab] to activate the extension.
3. Enter a piped list of intervals, for example:
    - 10 => 10 second interval
    - 10|20|30 => reloads after 10 then 20 and then 30 seconds
    - 10:20 => reload every 10 minutes and 20 seconds
    - 1:00:00 => reload every hour
4. Hit "r" + [tab] again and type in one of the following commands:
    - "stop"
    - "pause"
    - "start"
    - "config"
    - "about"

Click on the rr-icon on the omnibar to reveal a progress bar and see when the page is going to be reloaded again.
