#!/usr/bin/env node
const fs = require('node:fs');
const readline = require('node:readline');
const RenpyCounter = require('../index.js');
const debug = require('debug')('renpy-counter:bin');

const argv = require('yargs')
    .scriptName('renpy-counter')
    .usage('$0 [options] <files>...')
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
        default: 800,
        describe: 'non-CJK reading speed (characters per minutes)',
        type: 'number',
    })
    .option('S', {
        alias: 'cjk-speed',
        default: 300,
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
    .option('pause', {
        default: true,
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
    .option('f', {
        alias: 'by-file',
        describe: 'summarize each document individually',
        type: 'boolean',
    })
    .help()
    .argv;

debug(argv);

const Pause = Symbol('(pause)');
const Special = Symbol('(special)');
const Scene = Symbol('(scene)');
const Show = Symbol('(show)');
const Narrator = Symbol('(narrator)');

Map.prototype.increment = function (key, value) {
    if (!this.has(key))
        this.set(key, value);
    else
        this.set(key, this.get(key) + value);
};
Map.prototype.mergeMap = function (src) {
    for (const [k, v] of src.entries())
        this.increment(k, v);
};

function parser(line) {
    let m = line.match(/^(?:(?<nm>[a-zA-Z0-9_]+)\s+)?"(?<str>(?:[^"]|\\")*)"\s*(?:#.*)?$/);
    if (m) {
        let extras = 0;
        let st = m.groups.str.replace(/^(?:.*\{fast\})+/, '');
        st = st.replace(/\{[^{][^}]*\}|\[[^[][^]]*\]/g, (match) => {
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
    m = line.match(/^# renpy-counter\s+(?<t>[0-9]*(?:\.[0-9]*)?)\s*$/);
    if (m) {
        return {special: +m.groups.t};
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
    timeMap.set(Special, 0);
    timeMap.set(Scene, 0);
    timeMap.set(Show, 0);
    const cjkRe = /[\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff\uff66-\uff9f]/g;
    for (const txe of tx) {
        if (txe.pause) {
            time += txe.pause;
            timeMap.increment(Pause, txe.pause);
        } else if (txe.special) {
            time += txe.special;
            timeMap.increment(Special, txe.special);
        } else if (txe.scene) {
            time += argv.scene / 60;
            timeMap.increment(Scene, argv.scene / 60);
        } else if (txe.show) {
            time += argv.show / 60;
            timeMap.increment(Show, argv.show / 60);
        } else if (txe.st) {
            const cjk = (txe.st.match(cjkRe) || []).length;
            const ncjk = txe.st.length - cjk;
            const t = ncjk / argv.speed + cjk / argv['cjk-speed'] + txe.extras / 60 + argv.next / 60;
            if (argv['by-characters'])
                timeMap.increment(txe.nm, t);
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
        res.byCharacters.mergeMap(bb.totalTextAgg[1]);
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

async function runFile(file) {
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
    return result;
}

async function run() {
    const result = {
        config: {
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
            output: {
                byFile: argv['by-file'],
                byCharacters: argv['by-characters'],
                labels: argv.labels,
                texts: argv.texts,
            },
        },
    };
    {
        if (!argv.maximum) {
            result.minimum = {time: 0};
            if (argv.labels || argv.texts)
                result.minimum.path = [];
            if (argv['by-characters'])
                result.minimum.byCharacters = new Map();
        }
        if (!argv.minimum) {
            result.maximum = {time: 0};
            if (argv.labels || argv.texts)
                result.maximum.path = [];
            if (argv['by-characters'])
                result.maximum.byCharacters = new Map();
        }
    }
    const merge = ({time, path, byCharacters}, dst) => {
        dst.time += time;
        if (argv.labels || argv.texts)
            dst.path.push(...path);
        if (argv['by-characters'])
            dst.byCharacters.mergeMap(byCharacters);
    };

    const {Chalk} = await import('chalk');
    const chalk = new Chalk();
    if (!argv.json) {
        console.log(chalk.gray(`Assuming Non-CJK reading time is ${result.config.speed.ncjk} characters per minute.`));
        console.log(chalk.gray(`Assuming CJK reading time is ${result.config.speed.cjk} characters per minute.`));
    }
    const show = async (res) => {
        if (res.minimum) {
            console.log(chalk.magenta(`Minimum time to play: ${res.minimum.time} min`));
            await present(res.minimum, chalk);
        }
        if (res.maximum) {
            console.log(chalk.magenta(`Maximum time to play: ${res.maximum.time} min`));
            await present(res.maximum, chalk);
        }
    };
    for (const file of argv._) {
        const res = await runFile(file);
        if (argv['by-file']) {
            result[file] = res;
            if (!argv.json) {
                console.log(chalk.bgMagenta(file));
                await show(res);
            }
        } else {
            merge(res.minimum, result.minimum);
            merge(res.maximum, result.maximum);
        }
    }
    if (argv.json)
        console.log(JSON.stringify(result, replacer, 2));
    else if (!argv['by-file'])
        await show(result);
}

run();
