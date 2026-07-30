export interface LightingService {
    setSolidColor(r: number, g: number, b: number): Promise<void>
    disconnect(): Promise<void>
}
