'use client';

import React, { createContext, useContext } from 'react';
import io, { Socket } from 'socket.io-client';

type SocketContextValue = Socket;

const SocketContext = createContext<SocketContextValue | null>(null);

// Module-level singleton: survives StrictMode's mount/unmount/remount and Next
// fast-refresh. A useEffect-cleanup `socket.disconnect()` would be treated as
// final by socket.io-client (no auto-reconnect), leaving consumers wired to a
// dead socket — every event from the server would land on a closed listener.
let _socket: Socket | null = null;
function getSocket(): Socket {
	if (!_socket) _socket = io({ transports: ['websocket'] });
	return _socket;
}

export const SocketProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
	return (
		<SocketContext.Provider value={getSocket()}>
			{children}
		</SocketContext.Provider>
	);
};

/* small helper so consumers don’t need to handle null */
export const useSocket = (): Socket => {
	const ctx = useContext(SocketContext);
	if (!ctx) throw new Error('useSocket must be used inside <SocketProvider>');
	return ctx;
};
