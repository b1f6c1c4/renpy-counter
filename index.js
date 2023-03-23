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

    end(dead) {
        if (this.disabled)
            return;
        this.disabled = true;
        this.deadend = dead;
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
    constructor(par, agg) {
        this.textParser = par;
        this.textAggregator = agg;
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

    scope() {
        for (let i = this.stack.length - 1; i >= 0; i--)
            if (this.stack[i].scope)
                return this.stack[i].scope;
        if (this.init.scope)
            return this.init.scope;
        throw new Error("No scope available.");
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
            label: `#bb_${id}_push`,
        };
        switch (cmd) {
            case 'label':
                this.ensureNoParallel(id);
                obj.label = arg.replace(/\(.*\)/, '');
                if (!obj.label.startsWith('.'))
                    this.top().scope = obj.label;
                else
                    obj.label = this.scope() + obj.label;
                break;
            case 'menu':
                this.ensureNoParallel(id);
                obj.forking = 'regular';
                obj.collectibles = [];
                break;
            case 'if':
                this.ensureNoParallel(id);
                const label = `#bb_${id}_pushIf`;
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
                this.ensureNoParallel(id);
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
        const lbl = `#bb_${id}_pop${it}`;
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
        m = line.match(/^jump\s+(?<lbl>\S+)\s*(?:#.*)?$/);
        if (m) {
            const {lbl} = m.groups;
            const tgt = lbl.startsWith('.') ? this.scope() + lbl : lbl;
            debug('jump', tgt);
            this.top().bb.jump(tgt, true);
            return;
        }
        m = line.match(/^return[^#]*(?<dead>#.*dead.*)?$/);
        if (m) {
            this.top().bb.end(m.groups.dead);
            return;
        }
        const obj = this.textParser(line);
        if (obj) {
            debug('text-like', obj);
            this.bb().say(obj);
        }
    }

    forEachNext(bb, cb) {
        for (const nxLbl of bb.next) {
            const nx = this.bbRegistry.get(nxLbl);
            if (!nx)
                throw new Error(`Cannot find label ${nxLbl}`);
            cb(nx, nxLbl);
        }
    }

    forEachPrev(bb, cb) {
        for (const nxLbl of bb.incoming) {
            const nx = this.bbRegistry.get(nxLbl);
            if (!nx)
                throw new Error(`Cannot find label ${nxLbl}`);
            cb(nx, nxLbl);
        }
    }

    optimize() {
        this.ensureNoParallel('Inf');

        debug('optimize: before =', this.bbRegistry.size);
        const queue = [this.bbRegistry.get('')];
        while (queue.length) {
            const [bb] = queue.splice(0, 1);
            this.forEachNext(bb, (nx) => {
                if (!nx.incoming) nx.incoming = new Set();
                if (!nx.incoming.has(bb.label)) {
                    nx.incoming.add(bb.label)
                    queue.push(nx);
                }
            });
        }

        const newRegistry = new Map();
        queue.splice(0, queue.length, this.bbRegistry.get(''));
        while (queue.length) {
            const [bb] = queue.splice(0, 1);
            if (bb.next.length === 1) {
                const nx = this.bbRegistry.get(bb.next[0]);
                if (nx.label !== bb.next[0])
                    throw new Error(`Not matching label: ${nx.label} and ${bb.next[0]}`);
                const weld = () => {
                    bb.text.push(...nx.text);
                    bb.next = nx.next;
                    this.forEachNext(bb, (nnx) => {
                        nnx.incoming.delete(nx.label);
                        nnx.incoming.add(bb.label);
                    });
                    queue.push(bb);
                }
                if (nx.incoming.size === 1 && nx.label.startsWith('#')) {
                    debug('concat', bb.label, nx.label);
                    weld();
                    continue;
                }
                if (nx.incoming.size === 1 && bb.label.startsWith('#')) {
                    debug('reverse-concat', bb.label, nx.label);
                    for (const inc of bb.incoming) {
                        const pv = this.bbRegistry.get(inc);
                        pv.next = pv.next.map((n) => n === bb.label ? nx.label : n);
                    }
                    bb.label = nx.label;
                    weld();
                    continue;
                }
            }
            bb.opt_marked = true;
            newRegistry.set(bb.label, bb);
            this.forEachNext(bb, (nx) => {
                if (!nx.opt_marked) {
                    nx.opt_marked = true;
                    queue.push(nx);
                }
            });
        }

        for (const bb of newRegistry.values()) {
            delete bb.opt_marked;
            if (bb.incoming)
                bb.incoming.clear();
            else
                bb.incoming = new Set();
        }

        this.bbRegistry = newRegistry;
        debug('optimize: after =', this.bbRegistry.size);
        queue.splice(0, queue.length, this.bbRegistry.get(''));
        while (queue.length) {
            const [bb] = queue.splice(0, 1);
            bb.totalTextAgg = this.textAggregator(bb.text);
            debug('optimize totalTextAgg=', bb.totalTextAgg);
            if (Array.isArray(bb.totalTextAgg)) {
                bb.totalText = bb.totalTextAgg[0];
            } else {
                bb.totalText = bb.totalTextAgg;
            }
            if (!isFinite(bb.totalText)) {
                debug('optimize totalText=', bb.totalText);
                throw new Error('Invalid aggregator return');
            }
            this.forEachNext(bb, (nx) => {
                if (!nx.incoming.has(bb.label)) {
                    nx.incoming.add(bb.label)
                    queue.push(nx);
                }
            });
        }
    }

    // get min totalChar from '' to return
    spfa() {
        debug('spfa on ', this.bbRegistry.size);
        let answer = Infinity;
        let answerHop = undefined;
        const bb0 = this.bbRegistry.get('');
        bb0.spfa_dist = 0;
        const queue = [bb0];
        while (queue.length) {
            const [bb] = queue.splice(0, 1);
            bb.spfa_in_queue = false;
            const du0 = bb.spfa_dist === undefined ? Infinity : bb.spfa_dist;
            const du = du0 + bb.totalText;
            if (!bb.next.length && !bb.deadend && answer > du + 0) {
                answer = du + 0;
                answerHop = bb;
            }
            this.forEachNext(bb, (nx) => {
                const dv = nx.spfa_dist === undefined ? Infinity : nx.spfa_dist;
                if (dv <= du + 0)
                    return;
                nx.spfa_dist = du + 0;
                nx.spfa_hop = bb;
                if (!nx.spfa_in_queue) {
                    queue.push(nx);
                    nx.spfa_in_queue = true;
                }
            });
        }
        debug('spfa done');
        const hops = [];
        if (answerHop !== undefined)
            for (let ptr = answerHop; ptr; ptr = ptr.spfa_hop)
                hops.splice(0, 0, ptr);
        return [answer, hops];
    }

    // get max totalChar from '' to return
    kosaraju() {
        debug('kosaraju on ', this.bbRegistry.size);
        const Return = Symbol('return');
        const sccs = []; // { bbs, incoming, next }
        const s = [];
        const dfs1 = (bb) => {
            if (bb.kosaraju_seen)
                return;
            bb.kosaraju_seen = true;
            this.forEachNext(bb, dfs1);
            s.push(bb);
        };
        dfs1(this.bbRegistry.get(''));
        const dfs2 = (bb) => {
            if (bb.kosaraju_scc !== undefined)
                return;
            bb.kosaraju_scc = sccs[sccs.length - 1];
            bb.kosaraju_scc.bbs.push(bb);
            this.forEachPrev(bb, dfs2);
        };
        for (let i = s.length - 1; i >= 0; i--) {
            if (s[i].kosaraju_scc !== undefined)
                continue;
            sccs.push({bbs: []});
            dfs2(s[i]);
        }
        for (const scc of sccs) {
            // scc.incoming = new Set();
            scc.next = new Set();
            // scc.characters = new Set();
            scc.totalText = 0;
            for (const bb of scc.bbs) {
                delete bb.kosaraju_seen;
                scc.totalText += bb.totalText;
                // this.forEachPrev(bb, (nx) => {
                //     if (nx.kosaraju_scc !== scc)
                //         scc.incoming.add(nx.kosaraju_scc);
                // });
                if (bb.next.length) {
                    this.forEachNext(bb, (nx) => {
                        if (nx.kosaraju_scc !== scc)
                            scc.next.add(nx.kosaraju_scc);
                    });
                } else if (!bb.deadend) {
                    scc.next.add(Return);
                }
            }
        }
        debug('korasaju done');

        let answer = -Infinity;
        let answerHop = undefined;
        const scc0 = this.bbRegistry.get('').kosaraju_scc;
        scc0.spfa_dist = 0;
        const queue = [scc0];
        while (queue.length) {
            const [scc] = queue.splice(0, 1);
            scc.spfa_in_queue = false;
            const du0 = scc.spfa_dist === undefined ? -Infinity : scc.spfa_dist;
            const du = du0 + scc.totalText;
            for (const nx of scc.next) {
                if (nx === Return) {
                    if (answer < du + 0) {
                        answer = du + 0;
                        answerHop = scc;
                    }
                    continue;
                }
                const dv = nx.spfa_dist === undefined ? -Infinity : nx.spfa_dist;
                if (dv >= du + 0)
                    continue;
                nx.spfa_dist = du + 0;
                nx.spfa_hop = scc;
                if (!nx.spfa_in_queue) {
                    queue.push(nx);
                    nx.spfa_in_queue = true;
                }
            }
        }
        const hops = [];
        if (answerHop !== undefined)
            for (let ptr = answerHop; ptr; ptr = ptr.spfa_hop)
                hops.splice(0, 0, ptr);
        return [answer, hops];
    }

    analyze() {
        return [this.spfa()[0], this.kosaraju()[0]];
    }
}

module.exports = RenpyCounter;
