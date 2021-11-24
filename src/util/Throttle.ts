export class Throttle<K, V> {

    last: number = 0;
    queue: Entry<K, V>[] = [];

    constructor(readonly interval: number, readonly runner: Runner<K, V>) {
        setInterval(() => this.run(), 10);
    }

    get next() {
        return this.last + this.interval;
    }

    get size() {
        return this.queue.length;
    }

    async submit(k: K): Promise<V> {
        return new Promise<V>(resolve => {
            this.queue.push({
                k: k,
                consumer: resolve
            });
        });
    }

    private async run() {
        const now = Date.now();
        if (now > this.next) {
            const next = this.queue.shift();
            if (next) {
                this.last = now;
                const v = await this.runner(next.k);
                next.consumer(v);
            }
        }
    }

}

export type Runner<K, V> = (k: K) => Promise<V> | V;

interface Entry<K, V> {
    k: K;
    consumer: (v: V) => void;
}
