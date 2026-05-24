'use client';
import React, { useEffect, useRef } from 'react';
import { Flex, Grid, GridItem } from '@chakra-ui/react';
import { useClaw, ACTION_TO_KEY, KEYMAP } from '@/components/providers/ClawProvider';
import { useIsMobile } from './hooks/useIsMobile';

type Action = 'up' | 'down' | 'left' | 'right' | 'grab';

interface GameControllerProps {
  keySize?: number | string;
  buttonSize?: number | string;
}

const GLYPH: Record<Exclude<Action, 'grab'>, string> = {
  up: '↑',
  down: '↓',
  left: '←',
  right: '→',
};

const setActiveByAction = (action: Action, on: boolean) => {
  const el = document.querySelector<HTMLElement>(`[data-action="${action}"]`);
  if (!el) return;
  if (on) el.setAttribute('data-active', '');
  else el.removeAttribute('data-active');
};

const GameController: React.FC<GameControllerProps> = () => {
  const isMobile = useIsMobile();
  const { isPlaying, press, release } = useClaw();
  const grabRef = useRef<HTMLButtonElement>(null);

  /* cursor-tracked vars on GRAB — matches .play behavior */
  useEffect(() => {
    if (!isPlaying) return;
    let raf: number | null = null;
    const update = (cx: number, cy: number) => {
      const el = grabRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      el.style.setProperty('--lmx', `${cx - r.left}px`);
      el.style.setProperty('--lmy', `${cy - r.top}px`);
    };
    const onMove = (e: PointerEvent) => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = null;
        update(e.clientX, e.clientY);
      });
    };
    window.addEventListener('pointermove', onMove);
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [isPlaying]);

  const bind = (action: Action) => ({
    'data-action': action,
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();
      (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      setActiveByAction(action, true);
      press(action);
    },
    onPointerUp: () => {
      setActiveByAction(action, false);
      release(action);
    },
    onPointerLeave: () => {
      setActiveByAction(action, false);
      release(action);
    },
    onPointerCancel: () => {
      setActiveByAction(action, false);
      release(action);
    },
    onContextMenu: (e: React.MouseEvent) => e.preventDefault(),
  });

  useEffect(() => {
    if (!isPlaying) return;

    const down = (e: KeyboardEvent) => {
      if (e.key in KEYMAP) {
        const action = Object.entries(ACTION_TO_KEY).find(([, key]) => key === e.key)?.[0];
        if (action) {
          setActiveByAction(action as Action, true);
          press(action as keyof typeof ACTION_TO_KEY);
        }
      }
    };

    const up = (e: KeyboardEvent) => {
      if (e.key in KEYMAP) {
        const action = Object.entries(ACTION_TO_KEY).find(([, key]) => key === e.key)?.[0];
        if (action) {
          setActiveByAction(action as Action, false);
          release(action as keyof typeof ACTION_TO_KEY);
        }
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, [isPlaying, press, release]);

  if (!isPlaying) return null;

  const arrow = (action: Exclude<Action, 'grab'>, colStart: number, rowStart: number) => (
    <GridItem colStart={colStart} rowStart={rowStart}>
      <button className="kbd holo-rim spec" {...bind(action)}>
        <span className="kbd__glyph">{GLYPH[action]}</span>
      </button>
    </GridItem>
  );

  return (
    <Flex
      align="center"
      justify="space-evenly"
      w="100%"
      h="100%"
      containerType="size"
      css={!isMobile && {
        '@media (max-width: 175vh)': {
          flexDirection: 'column',
        },
      }}
    >
      <Grid gap="0.9vh">
        {arrow('up', 2, 1)}
        {arrow('left', 1, 2)}
        {arrow('down', 2, 2)}
        {arrow('right', 3, 2)}
      </Grid>
      <button ref={grabRef} className="grab holo-rim spec" {...bind('grab')}>
        <span className="grab__inner-gloss" />
        <span className="grab__sweep" />
        <span className="grab__label">GRAB</span>
      </button>
    </Flex>
  );
};

export default GameController;
