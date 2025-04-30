'use client';

import React, { createContext, useContext, useMemo, useEffect } from 'react';
import io, { Socket } from 'socket.io-client';

type SocketContextValue = Socket;

const SocketContext = createContext<SocketContextValue | null>(null);

export const SocketProvider: React.FC<React.PropsWithChildren> = ({ children }) => {
	// create once per tab ‑‑ hot‑reload safe
	const socket = useMemo(() => io({ transports: ['websocket'] }), []);

	// tidy up on full page unload / next‑js route change to a non‑client tree
	useEffect(() => {
		return () => {
			socket.disconnect();
		}
	}, [socket]);

	return (
		<SocketContext.Provider value={socket}>
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
