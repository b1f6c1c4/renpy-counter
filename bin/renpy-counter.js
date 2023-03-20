#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const RenpyCounter = require('../index.js');
const debug = require('debug')('renpy-counter:bin');

const argv = require('yargs')
    .scriptName('renpy-counter')
    .usage('$0 [options] <files>')
    .option('j', {
        alias: 'json',
        describe: 'output json format',
        type: 'boolean',
    })
    .option('m', {
        alias: ['min', 'minimum'],
        describe: 'only compute minimum/shortest',
        type: 'boolean',
    })
    .option('M', {
        alias: ['max', 'maximum'],
        describe: 'only compute maximum/longest',
        type: 'boolean',
    })
    .conflicts('m', 'M')
    .option('c', {
        alias: 'character',
        describe: 'list of characters: char,from=to,from=to',
        type: 'string',
        coerce: (arg) => {
            const map = new Map();
            arg.split(',').forEach((s) => {
                const m = s.match(/^(?<from>[^=]*)=(?<to>.*)$/);
                if (m)
                    map.set(m.groups.from, m.groups.to);
                else
                    map.set(s, s);
            });
        },
    })
    .option('C', {
        alias: 'by-characters',
        default: false,
        describe: 'tally text amount for each characters',
        type: 'boolean',
    })
    .option('s', {
        alias: 'speed',
        default: 582.9,
        describe: 'non-CJK reading speed (characters per minutes)',
        type: 'number',
    })
    .option('S', {
        alias: 'cjk-speed',
        default: 110.0,
        describe: 'CJK reading speed (characters per minutes)',
        type: 'number',
    })
    .option('scene', {
        default: 0.8,
        describe: 'time (seconds) spend on changing scene',
        type: 'number',
    })
    .option('show', {
        default: 0.25,
        describe: 'time (seconds) spend on showing/hiding objects',
        type: 'number',
    })
    .option('next', {
        default: 0.3,
        describe: 'time (seconds) spend on next',
        type: 'number',
    })
    .option('p', {
        alias: 'pause',
        describe: 'include paused time',
        type: 'boolean',
    })
    .option('l', {
        alias: 'labels',
        describe: 'list the shortest/longest path by labels',
        type: 'boolean',
    })
    .option('t', {
        alias: 'texts',
        describe: 'list the shortest/longest path by texts',
        type: 'boolean',
    })
    .help()
    .argv;

debug(argv);

const Pause = Symbol('(pause)');
const Scene = Symbol('(scene)');
const Show = Symbol('(show)');
const Narrator = Symbol('(narrator)');

function parser(line) {
    let m = line.match(/^(?:(?<nm>[a-zA-Z0-9_]+)\s+)?"(?<str>(?:[^"]|\\")*)"\s*(?:#.*)?$/);
    if (m) {
        let extras = 0;
        const st = m.groups.str.replace(/\{[^{][^}]*\}|\[[^[][^]]*\]/g, (match) => {
            if (match.startsWith('{w='))
                extras += +match.substring(3, match.length - 2) / 60;
            return '';
        });
        const nm = argv.characters ? argv.characters.get(m.groups.nm) : m.groups.nm || Narrator;
        return {nm, st, extras};
    }
    m = line.match(/^pause\s+(?<t>[0-9]*(?:\.[0-9]*)?)\s*$/);
    if (m && argv.pause) {
        return {pause: +m.groups.t / 60};
    }
    if (/^scene\s+/.test(line)) {
        return {scene: 1};
    }
    if (/^(?:show|hide)\s+/.test(line)) {
        return {show: 1};
    }
}

function aggregator(tx) {
    let time = 0;
    const timeMap = new Map();
    if (argv.pause)
        timeMap.set(Pause, 0);
    timeMap.set(Scene, 0);
    timeMap.set(Show, 0);
    const cjkRe = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/g;
    for (const txe of tx) {
        if (txe.pause) {
            time += txe.pause;
            timeMap.set(Pause, timeMap.get(Pause) + txe.pause);
        } else if (txe.scene) {
            time += argv.scene / 60;
            timeMap.set(Scene, timeMap.get(Scene) + argv.scene / 60);
        } else if (txe.show) {
            time += argv.show / 60;
            timeMap.set(Show, timeMap.get(Show) + argv.show / 60);
        } else if (txe.st) {
            const cjk = (txe.st.match(cjkRe) || []).length;
            const ncjk = txe.st.length - cjk;
            const t = ncjk / argv.speed + cjk / argv['cjk-speed'] + txe.extras / 60 + argv.next / 60;
            if (argv['by-characters']) {
                if (!timeMap.has(txe.nm))
                    timeMap.set(txe.nm, t);
                else
                    timeMap.set(txe.nm, timeMap.get(txe.nm) + t);
            }
            time += t;
        }
    }
    if (argv['by-characters'])
        return [time, timeMap];
    return time;
}

function breakdown([time, path]) {
    const res = {
        time,
        byCharacters: new Map(),
    };
    if (argv.labels || argv.texts)
        res.path = [];
    const getText = (bb) => {
        const sts = [];
        for (const {nm, st} of bb.text)
            if (st)
                sts.push({nm, st});
        return sts;
    };
    const mkPath = (bb) => {
        if (argv.labels && !argv.texts)
            return [bb.label];
        else if (argv.texts && !argv.labels)
            return getText(bb);
        else // if (argv.texts && argv.labels)
            return [{lbl: bb.label, txt: getText(bb)}];
    };
    const merge = (bb) => {
        for (const [k, v] of bb.totalTextAgg[1].entries())
            if (!res.byCharacters.has(k))
                res.byCharacters.set(k, v);
            else
                res.byCharacters.set(k, res.byCharacters.get(k) + v);
    };
    for (const obj of path) {
        if (obj.bbs && obj.bbs.length > 1) { // scc
            if (argv.labels || argv.texts)
                res.path.push(obj.bbs.map((bb) => mkPath(bb)).flat(1));
            if (argv['by-characters'])
                obj.bbs.forEach(merge);
        } else {
            const bb = obj.bbs ? obj.bbs[0] : obj;
            if (argv.labels || argv.texts)
                res.path.push(...mkPath(bb))
            if (argv['by-characters'])
                merge(bb);
        }
    }
    if (!argv['by-characters'])
        delete res.byCharacters;
    return res;
}

function replacer(key, value) {
    if (value instanceof Map) {
        return {
            dataType: 'Map',
            value: Object.fromEntries(value.entries()), // or with spread: value: [...value]
        };
    } else {
        return value;
    }
}

function present({path, byCharacters}, chalk) {
    if (argv['by-characters']) {
        const ent = [...byCharacters.entries()];
        ent.sort((a, b) => b[1] - a[1]);
        for (const [k, v] of ent)
            if (typeof k === 'symbol')
                console.log(`${chalk.cyan(k.description)} ${v}`)
            else
                console.log(`${chalk.green(k)} ${v}`);
    }
    if (path) {
        console.log('Path:');
        const display = (ent, indent) => {
            if (argv.labels) {
                const lbl = argv.texts ? ent.lbl : ent;
                if (lbl.startsWith('#'))
                    console.log(indent + chalk.gray(lbl));
                else
                    console.log(indent + chalk.bgMagenta(lbl));
            }
            if (argv.texts) {
                const txt = argv.labels ? ent.txt : [ent];
                const ind = argv.labels ? '    ' + indent : indent;
                for (const {nm, st} of txt)
                    if (typeof nm === 'symbol')
                        console.log(ind + `${chalk.cyan(nm.description)} "${st}"`)
                    else
                        console.log(ind + `${chalk.green(nm)} "${st}"`);
            }
        };
        for (const obj of path) {
            if (Array.isArray(obj)) {
                console.log('    ' + chalk.bgBlue('Loop:'));
                for (const ent of obj)
                    display(ent, '        ');
            } else if (obj.st || obj.lbl || obj.txt && obj.txt.length) {
                display(obj, '    ');
            }
        }
    }
}

async function run() {
    for (const file of argv._) {
        const rl = readline.createInterface({
            input: fs.createReadStream(file),
            crlfDelay: Infinity,
        });

        const counter = new RenpyCounter(parser, aggregator);
        let i = 0;
        for await (let line of rl) {
            if (line.charCodeAt(0) === 0xFEFF) {
                line = line.substring(1);
            }
            ++i;
            debug(`Line from file: ${i}:${line}`);
            counter.parseLine(line, i);
        }
        counter.optimize();
        const result = {};
        if (!argv.maximum) {
            result.minimum = breakdown(counter.spfa());
        }
        if (!argv.minimum) {
            result.maximum = breakdown(counter.kosaraju());
        }
        result.config = {
            speed: {
                ncjk: argv.speed,
                cjk: argv['cjk-speed'],
            },
            extra: {
                pause: !!argv.pause,
                scene: argv.scene,
                show: argv.show,
                next: argv.next,
            },
        };
        if (argv.json) {
            console.log(JSON.stringify(result, replacer, 2));
        } else {
            const {Chalk} = await import('chalk');
            const chalk = new Chalk();
            console.log(chalk.gray(`Assuming Non-CJK reading time is ${result.config.speed.ncjk} characters per minute.`));
            console.log(chalk.gray(`Assuming CJK reading time is ${result.config.speed.cjk} characters per minute.`));
            if (result.minimum) {
                console.log(chalk.magenta(`Minimum time to play: ${result.minimum.time} min`));
                await present(result.minimum, chalk);
            }
            if (result.maximum) {
                console.log(chalk.magenta(`Maximum time to play: ${result.maximum.time} min`));
                await present(result.maximum, chalk);
            }
        }
    }
}

run();
