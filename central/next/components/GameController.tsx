'use client';
import React, { useEffect } from 'react';
import { Button, Flex, Grid, GridItem, FlexProps } from '@chakra-ui/react';
import { useClaw, ACTION_TO_KEY, KEYMAP } from '@/components/providers/ClawProvider';
import { useIsMobile } from './hooks/useIsMobile';

type KbdProps =
  FlexProps &               // chakra styling props
  React.ButtonHTMLAttributes<HTMLButtonElement>; // onMouseDown, disabled, etc.

export const Kbd: React.FC<KbdProps> = ({ children, h = 4, w = 4, ...props }) => {
  return <Flex
    as="button"
    fontFamily="auto"
    align="center"
    justify="center"
    border={{ base: "0.4vh solid black", _dark: "0.4vh solid white" }}
    h={h}
    minH={"6.5vh"}
    w={w}
    minW={"6.5vh"}
    p={"1.4vw"}
    borderRadius="md"
    fontSize="3.6vh"
    userSelect="none"
    touchAction="none"
    onContextMenu={e => e.preventDefault()}
    css={{
      "&[data-active]": {
        background: { base: "black", _dark: "white" },
        color: { base: "white", _dark: "black" }
      }
    }}
    {...props}
  >
    {children}
  </Flex>
}

interface GameControllerProps {
  keySize?: number | string,
  buttonSize?: number | string
}

type Action = 'up' | 'down' | 'left' | 'right' | 'grab';

const setActiveByAction = (action: Action, on: boolean) => {
  const el = document.querySelector<HTMLElement>(`[data-action="${action}"]`);
  if (!el) return;
  if (on) el.setAttribute('data-active', '');
  else el.removeAttribute('data-active');
};

const GameController: React.FC<GameControllerProps> = ({
  keySize = 4,
  buttonSize = 28
}: GameControllerProps) => {
  const isMobile = useIsMobile();
  const { isPlaying, press, release } = useClaw();
  if (!isPlaying) return null;

  /* helper that wires the proper pointer events */
  const bind = (action: Action) => ({
    'data-action': action,
    onPointerDown: (e: React.PointerEvent<HTMLElement>) => {
      e.preventDefault();               // <- stops text-selection/drag
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
    },   // finger slides away
    onPointerCancel: () => {
      setActiveByAction(action, false);
      release(action);
    },  // browser gesture cancelled
  }
  );

  /* keyboard listeners */
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

  return (
    <Flex
      align="center"
      justify={"space-evenly"}
      w={"100%"}
      h={"100%"}
      containerType={"size"}
      css={!isMobile && {
        "@media (max-width: 175vh)": {
          flexDirection: "column"
        }
      }}
    >
      <Grid
        gap={"0.8vh"}
      >
        {/* row 1, col 2  ── UP */}
        <GridItem colStart={2} rowStart={1}>
          <Kbd w={keySize} h={keySize} {...bind('up')}>&uarr;</Kbd>
        </GridItem>

        {/* row 2, col 1  ── LEFT */}
        <GridItem colStart={1} rowStart={2}>
          <Kbd w={keySize} h={keySize} {...bind('left')}>&larr;</Kbd>
        </GridItem>

        {/* row 2, col 2  ── DOWN */}
        <GridItem colStart={2} rowStart={2}>
          <Kbd w={keySize} h={keySize} {...bind('down')}>&darr;</Kbd>
        </GridItem>

        {/* row 2, col 3  ── RIGHT */}
        <GridItem colStart={3} rowStart={2}>
          <Kbd w={keySize} h={keySize} {...bind('right')}>&rarr;</Kbd>
        </GridItem>
      </Grid>
      <Button
        h={buttonSize}
        minH={"14vh"}
        color={{ base: "black", _dark: "white" }}
        bg={{ base: "white", _dark: "black" }}
        border={{ base: "0.4vh solid black", _dark: "0.4vh solid white" }}
        borderRadius="full"
        aspectRatio={1}
        fontSize="3.6vh"
        touchAction="none"
        onContextMenu={e => e.preventDefault()}
        css={{
          "&[data-active]": {
            background: { base: "black", _dark: "white" },
            color: { base: "white", _dark: "black" }
          }
        }}
        {...bind('grab')}
      >
        GRAB
      </Button>
    </Flex>
  );
};

export default GameController;
