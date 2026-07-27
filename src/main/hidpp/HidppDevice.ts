import type { HIDAsync } from 'node-hid'

const LOGITECH_SHORT_MESSAGE = 0x10
const LOGITECH_LONG_MESSAGE = 0x11
const LOGITECH_LONG_MESSAGE_LEN = 20

export const HIDPP20_SW_ID = 0x07
export const ROOT_IDX = 0x00
export const FN_ROOT_GET_FEATURE = 0x00

const READ_TIMEOUT_MS = 500

export class HidppDevice {
    constructor(private readonly dev: HIDAsync, private readonly deviceIndex: number) {}

    async sendAndReceive(featIdx: number, func: number, data: number[] = []): Promise<Buffer | null> {
        const buf = Buffer.alloc(LOGITECH_LONG_MESSAGE_LEN)
        buf[0] = LOGITECH_LONG_MESSAGE
        buf[1] = this.deviceIndex
        buf[2] = featIdx
        buf[3] = func | HIDPP20_SW_ID
        Buffer.from(data).copy(buf, 4)

        const written = await this.dev.write(buf)
        if (process.env.HID_DEBUG) {
            console.log(`  send(dev_idx=0x${this.deviceIndex.toString(16)}):`, buf.toString('hex'), 'written=', written)
        }

        const deadline = Date.now() + READ_TIMEOUT_MS
        while (Date.now() < deadline) {
            const remaining = deadline - Date.now()
            let resp: Buffer | undefined
            try {
                resp = await this.dev.read(Math.max(remaining, 1))
            } catch (e) {
                return null
            }

            if (!resp || resp.length === 0) {
                continue
            }

            if (process.env.HID_DEBUG) {
                console.log('  recv:', resp.toString('hex'))
            }

            const reportId = resp[0]
            if (reportId !== LOGITECH_SHORT_MESSAGE && reportId !== LOGITECH_LONG_MESSAGE) {
                continue
            }

            const respFeat = resp[2]
            const respFunc = resp[3]

            if (respFeat === 0xff) {
                const errFeat = resp[3]
                if (errFeat === featIdx) {
                    return null
                }
                continue
            }

            if (respFeat === featIdx && (respFunc & 0xf0) === (func & 0xf0)) {
                return Buffer.from(resp.slice(4))
            }
        }

        return null
    }

    async getFeatureIndex(featurePage: number): Promise<number> {
        const data = await this.sendAndReceive(ROOT_IDX, FN_ROOT_GET_FEATURE, [
            (featurePage >> 8) & 0xff,
            featurePage & 0xff
        ])
        if (!data) return 0
        return data[0]
    }

    close(): Promise<void> {
        return this.dev.close()
    }
}
