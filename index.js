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
        this.bbRegistry = new Map();
        this.init = {
            bb: this.allocate(''),
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
            case 'elif':
            case 'else':
                obj.forking = 'parallel';
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
            case 'regular': {
                debug('implicit jump', this.bb().label, '->', lbl);
                const lvl = this.stack.pop();
                lvl.collectibles.forEach((bb) => {
                    bb.jump(lbl);
                });
                debug('pop regular', lvl);
                this.bb(this.allocate(lbl)).jump(lbl);
                break;
            }
            case 'parallel': {
                debug('implicit jump', this.bb().label, '->', lbl);
                const lvl = this.stack.pop();
                debug('pop parallel', lvl);
                this.bb(this.allocate(lbl)).jump(lbl);
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

    optimize() {
        const queue = [this.bbRegistry.get('')];
        // mark all
        while (queue.length) {
            const [bb] = queue.splice(0, 1);
            for (const nxlbl of bb.next) {
                const nx = this.bbRegistry.get(nxlbl);
                if (!nx)
                    throw new Error(`Cannot find label ${nxlbl}`);
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
            newRegistry.set(bb.label, bb);
            if (bb.next.length === 1) {
                const nx = this.bbRegistry.get(bb.next[0]);
                if (nx.label !== bb.next[0])
                    throw new Error(`Not matching label: ${nx.label} and ${bb.next[0]}`);
                if (nx.incoming.size === 1 && nx.label.startsWith('#')) {
                    debug('concat', bb.label, nx.label)
                    bb.text.push(...nx.text);
                    bb.next = nx.next;
                    queue.push(bb);
                    continue;
                }
            }
            bb.optimized = true;
            for (const nx of bb.next) {
                const nx = this.bbRegistry.get(bb.next[0]);
                if (nx.label !== bb.next[0])
                    throw new Error(`Not matching label: ${nx.label} and ${bb.next[0]}`);
                if (!nx.optimized)
                    queue.push(nx);
            }
        }
        this.bbRegistry = newRegistry;
    }
}

module.exports = RenpyCounter;
