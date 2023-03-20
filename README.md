# renpy-counter

> Estimate the length of your Ren'Py game (i.e. how long an average player plays your game)

## Install

```
npm install -g renpy-counter
```

## Usage

```
renpy-counter [options] <files>...

Options:
      --version         Show version number                            [boolean]
  -j, --json            output json format                             [boolean]
  -m, --min, --minimum  only compute minimum/shortest                  [boolean]
  -M, --max, --maximum  only compute maximum/longest                   [boolean]
  -c, --character       list of characters: char,from=to,from=to        [string]
  -C, --by-characters   tally text amount for each characters
                                                      [boolean] [default: false]
  -s, --speed           non-CJK reading speed (characters per minutes)
                                                       [number] [default: 582.9]
  -S, --cjk-speed       CJK reading speed (characters per minutes)
                                                         [number] [default: 110]
      --scene           time (seconds) spend on changing scene
                                                         [number] [default: 0.8]
      --show            time (seconds) spend on showing/hiding objects
                                                        [number] [default: 0.25]
      --next            time (seconds) spend on next     [number] [default: 0.3]
      --pause           include paused time            [boolean] [default: true]
  -l, --labels          list the shortest/longest path by labels       [boolean]
  -t, --texts           list the shortest/longest path by texts        [boolean]
  -f, --by-file         summarize each document individually           [boolean]
      --help            Show help                                      [boolean]
```
