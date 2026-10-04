export type PortReservationRelease = () => void;

export interface PortReservations {
    claim(port: number): PortReservationRelease | undefined;
}

export function createPortReservations(): PortReservations {
    const claims = new Map<number, symbol>();
    return {
        claim(port) {
            if (claims.has(port)) return undefined;
            const owner = Symbol();
            claims.set(port, owner);
            return () => {
                if (claims.get(port) === owner) claims.delete(port);
            };
        },
    };
}
