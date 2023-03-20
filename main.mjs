import fs from 'node:fs';
import readline from 'node:readline';

const bbRegistry = {};

class BasicBlock {
    constructor(label) {
        this.label = label;
        this.text = [];
        this.next = [];
    }

    say(obj) {
        this.text.push(obj);
    }

    jump(lbl) {
        if (lbl === this.label)
            throw new Error('Do not jump yourself');
        if (this.disabled)
            return;
        this.next.push(lbl);
    }
}

class RenpyCounter {
    constructor() {
        this.stack = [];
        this.initBB = new BasicBlock();
    }

    top() {
        return this.stack[this.stack.length - 1];
    }

    bb(obj) {
        if (obj) {
            let old;
            if (this.empty())
                old = this.initBB, this.initBB = obj;
            else
                old = this.top().bb, this.top().bb = obj;
            return old;
        }
        return this.empty() ? this.initBB : this.top().bb;
    }

    empty() {
        return !this.stack.length;
    }

    push({ cmd, arg }, id) {
        const obj = {
            active: true,
            label: `#bb${id}push`,
        };
        switch (cmd) {
            case 'label':
                obj.label = arg;
                break;
            case 'menu':
                obj.forking = 'regular';
                break;
            case 'if':
            case 'elif':
            case 'else':
                obj.forking = 'parallel';
                break;
            default:
                break;
        }
        console.log('implicit jump', this.bb().label, '->', obj.label);
        this.bb().jump(obj.label);
        obj.bb = bbRegistry[arg] = new BasicBlock(obj.label);
        console.log('push', obj);
        this.stack.push(obj);
    }

    pop(id, it) {
        const lbl = `#bb${id}pop${it}`;
        switch (this.top().forking) {
            case undefined: {
                console.log('implicit jump', this.bb().label, '->', lbl);
                this.bb().jump(lbl);
                const lvl = this.stack.pop();
                console.log('pop non-forking', lvl);
                this.bb(bbRegistry[lbl] = new BasicBlock(lbl));
                break;
            }
            case 'regular': {
                console.log('implicit jump', this.bb().label, '->', lbl);
                const lvl = this.stack.pop();
                // TODO: join the forks
                console.log('pop regular', lvl);
                this.bb(bbRegistry[lbl] = new BasicBlock(lbl)).jump(lbl);
                break;
            }
            case 'parallel': {
                console.log('implicit jump', this.bb().label, '->', lbl);
                const lvl = this.stack.pop();
                console.log('pop parallel', lvl);
                this.bb(bbRegistry[lbl] = new BasicBlock(lbl)).jump(lbl);
            }
        }
    }

    say({ nm, str }) {
        const st = str.replace(/\{[^{][^}]*\}|\[[^[][^]]*\]/g, '');
        console.log('say', nm, st);
        this.bb().say({ nm, str: st });
    }

    jump({ lbl }) {
        console.log('jump', lbl);
        this.top().disabled = true;
        this.top().bb.jump(lbl);
    }

    parseLine(line0, id) {
        let line = line0;
        if (/^\s*$/.test(line))
            return;
        if (this.empty()) {
            if (!/^\S/.test(line))
                throw new Error(`Wrong indent, blame pYtHoN: ${id}:${line0}`);
        } else if (this.top().active) { // first line after `:`
            if (this.stack.length >= 2) {
                const len = this.stack[this.stack.length - 2].indent;
                if (!line.startsWith(len))
                    throw new Error(`Wrong indent, blame pYtHoN: ${id}:${line0}`);
                line = line.substr(len);
            }
            const m = line.match(/^(?<indent>\s+)/)
            if (!m)
                throw new Error(`Wrong indent, blame pYtHoN: ${id}:${line0}`);
            this.top().active = false;
            this.top().indent = m.groups.indent;
            console.log('adjust active:', this.top());
            line = line.substr(m.groups.indent.length);
        } else { // second or more lines after `:`
            let it = 0;
            while (!this.empty() && !line.startsWith(this.top().indent))
                this.pop(id, it++);
            if (!this.empty())
                line = line.substr(this.top().indent.length);
            if (!/^\S/.test(line))
                throw new Error(`Wrong indent, blame pYtHoN: ${id}:${line0}`);
        }
        let m = line.match(/(?:^(?<cmd>[a-z]+)\s*(?<arg>\(.*\)|\S.*)?)?:\s*$/);
        if (m) {
            this.push(m.groups, id);
            return;
        }
        m = line.match(/^(?:(?<nm>[a-zA-Z0-9_]+)\s+)?"(?<str>(?:[^"]|\\")*)"\s*$/);
        if (m) {
            this.say(m.groups);
            return;
        }
        m = line.match(/^jump\s+(?<lbl>\S+)\s*$/);
        if (m) {
            this.jump(m.groups);
        }
    }
};

const rl = readline.createInterface({
    input: fs.createReadStream(process.argv[2]),
    crlfDelay: Infinity,
});

const counter = new RenpyCounter();

let i = 0;
for await (let line of rl) {
    if (line.charCodeAt(0) === 0xFEFF) {
        line = line.substr(1);
    }
    ++i;
    console.log(`Line from file: ${i}:${line}`);
    counter.parseLine(line, i);
}
