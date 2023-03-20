const debug = require('debug')('renpy-counter:core');

class BasicBlock {
    constructor(label) {
        this.label = label;
        this.text = [];
        this.next = [];
    }

    say(obj) {
        this.text.push(obj);
    }

    jump(lbl, force) {
        if (lbl === this.label)
            throw new Error('Do not jump yourself');
        if (this.disabled)
            return;
        if (force)
            this.disabled = true;
        this.next.push(lbl);
    }
}

class RenpyCounter {
    constructor() {
        this.stack = [];
        this.bbRegistry = new Map();
        this.init = {
            bb: this.allocate(''),
            indent: '',
        };
    }

    allocate(label) {
        const bb = new BasicBlock(label);
        this.bbRegistry.set(label, bb);
        return bb;
    }

    bbSize() {
        return this.bbRegistry.size;
    }

    top() {
        if (this.empty())
            return this.init;
        return this.stack[this.stack.length - 1];
    }

    bb(obj) {
        if (obj) {
            const old = this.top().bb;
            this.top().bb = obj;
            return old;
        }
        return this.top().bb;
    }

    empty() {
        return !this.stack.length;
    }

    ensureNoParallel(id) {
        if (this.top().forking === 'parallel')
            this.pop(id, 'If');
    }

    push({cmd, arg}, id) {
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
                obj.collectibles = [];
                break;
            case 'if':
                const label = `#bb${id}pushIf`;
                this.top().bb.jump(label, true);
                this.stack.push({
                    active: false,
                    label,
                    forking: 'parallel',
                    collectibles: [],
                    bb: this.allocate(label),
                    indent: this.top().indent,
                    direct: true,
                });
                obj.collectibles = this.top().collectibles;
                break;
            case 'else':
                if (this.top().forking !== 'parallel')
                    throw new Error('Incorrect "else" location');
                this.top().direct = false;
                // fallthrough
            case 'elif':
                obj.collectibles = this.top().collectibles;
                break;
            default:
                if (this.top().forking === 'regular')
                    obj.collectibles = this.top().collectibles;
                break;
        }
        debug('implicit jump', this.bb().label, '->', obj.label);
        this.bb().jump(obj.label);
        obj.bb = this.allocate(obj.label);
        debug('push', obj);
        this.stack.push(obj);
    }

    pop(id, it) {
        const lbl = `#bb${id}pop${it}`;
        switch (this.top().forking) {
            case undefined: {
                if (this.top().collectibles) {
                    this.top().collectibles.push(this.bb());
                    const lvl = this.stack.pop();
                    debug('pop for forking', lvl);
                } else {
                    debug('implicit jump', this.bb().label, '->', lbl);
                    this.bb().jump(lbl);
                    const lvl = this.stack.pop();
                    debug('pop non-forking', lvl);
                    this.bb(this.allocate(lbl));
                }
                break;
            }
            case 'parallel':
            case 'regular': {
                debug('implicit jump', this.bb().label, '->', lbl);
                const lvl = this.stack.pop();
                lvl.collectibles.forEach((bb) => {
                    bb.jump(lbl);
                });
                debug('pop branch', lvl);
                this.bb(this.allocate(lbl));
                if (lvl.direct)
                    lvl.bb.jump(lbl);
                break;
            }
        }
    }

    say({nm, str}) {
        const st = str.replace(/\{[^{][^}]*\}|\[[^[][^]]*\]/g, '');
        debug('say', nm, st);
        this.bb().say({nm, str: st});
    }

    jump({lbl}) {
        debug('jump', lbl);
        this.top().bb.jump(lbl, true);
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
                line = line.substring(len);
            }
            const m = line.match(/^(?<indent>\s+)/)
            if (m) {
                this.top().active = false;
                this.top().indent = m.groups.indent;
                debug('adjust active:', this.top());
                line = line.substring(m.groups.indent.length);
            } else {
                this.pop(id, 0);
            }
        } else { // second or more lines after `:`
            let it = 0;
            while (!this.empty() && !line.startsWith(this.top().indent))
                this.pop(id, it++);
            if (!this.empty())
                line = line.substring(this.top().indent.length);
            if (!/^\S/.test(line))
                throw new Error(`Wrong indent, blame pYtHoN: ${id}:${line0}`);
        }
        let m = line.match(/(?:^(?<cmd>[a-z]+)\s*(?<arg>\(.*\)|\S.*)?)?:\s*(?:#.*)?$/);
        if (m) {
            this.push(m.groups, id);
            return;
        }
        this.ensureNoParallel(id);
        m = line.match(/^(?:(?<nm>[a-zA-Z0-9_]+)\s+)?"(?<str>(?:[^"]|\\")*)"\s*(?:#.*)?$/);
        if (m) {
            this.say(m.groups);
            return;
        }
        m = line.match(/^jump\s+(?<lbl>\S+)\s*(?:#.*)?$/);
        if (m) {
            this.jump(m.groups);
        }
    }

    optimize() {
        this.ensureNoParallel('Inf');
        const queue = [this.bbRegistry.get('')];
        // mark all
        while (queue.length) {
            const [bb] = queue.splice(0, 1);
            for (const nxLbl of bb.next) {
                const nx = this.bbRegistry.get(nxLbl);
                if (!nx)
                    throw new Error(`Cannot find label ${nxLbl}`);
                if (!nx.incoming) nx.incoming = new Set();
                if (!nx.incoming.has(bb.label)) {
                    nx.incoming.add(bb.label)
                    queue.push(nx);
                }
            }
        }
        const newRegistry = new Map();
        queue.splice(0, queue.length, this.bbRegistry.get(''));
        while (queue.length) {
            const [bb] = queue.splice(0, 1);
            if (bb.next.length === 1) {
                const nx = this.bbRegistry.get(bb.next[0]);
                if (nx.label !== bb.next[0])
                    throw new Error(`Not matching label: ${nx.label} and ${bb.next[0]}`);
                if (nx.incoming.size === 1 && nx.label.startsWith('#')) {
                    debug('concat', bb.label, nx.label);
                    bb.text.push(...nx.text);
                    bb.next = nx.next;
                    queue.push(bb);
                    continue;
                }
                if (nx.incoming.size === 1 && bb.label.startsWith('#')) {
                    debug('reverse-concat', bb.label, nx.label);
                    for (const inc of bb.incoming) {
                        const pv = this.bbRegistry.get(inc);
                        pv.next = pv.next.map((n) => n === bb.label ? nx.label : n);
                    }
                    bb.label = nx.label;
                    bb.text.push(...nx.text);
                    bb.next = nx.next;
                    queue.push(bb);
                    continue;
                }
            }
            bb.opt_marked = true;
            newRegistry.set(bb.label, bb);
            for (const nxLbl of bb.next) {
                const nx = this.bbRegistry.get(nxLbl);
                if (nx.label !== nxLbl)
                    throw new Error(`Not matching label: ${nx.label} and ${nxLbl}`);
                if (!nx.opt_marked) {
                    nx.opt_marked = true;
                    queue.push(nx);
                }
            }
        }
        for (const bb of newRegistry.values())
            delete bb.opt_marked;
        this.bbRegistry = newRegistry;
    }
}

module.exports = RenpyCounter;
