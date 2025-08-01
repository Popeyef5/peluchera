'use client';
import React from 'react';
import { Button, Flex, Grid, GridItem, FlexProps } from '@chakra-ui/react';
import { useClaw } from '@/components/providers/ClawProvider';

type KbdProps =
  FlexProps &               // chakra styling props
  React.ButtonHTMLAttributes<HTMLButtonElement>; // onMouseDown, disabled, etc.

export const Kbd: React.FC<KbdProps> = ({ children, ...props }) => {
  return <Flex
    as="button"
    fontFamily="auto"
    align="center"
    justify="center"
    border={{ base: "0.25rem solid black", _dark: "0.25rem solid white" }}
    h={4}
    w={4}
    p={6}
    borderRadius="md"
    fontSize="4xl"
    userSelect="none"
    touchAction="none"
    onContextMenu={e => e.preventDefault()}
    {...props}
  >
    {children}
  </Flex>
}

type Action = 'up' | 'down' | 'left' | 'right' | 'grab';

const GameController: React.FC = () => {
  const { isPlaying, press, release } = useClaw();
  if (!isPlaying) return null;

  /* helper that wires the proper pointer events */
  const bind = (action: Action) => ({
    onPointerDown: () => press(action),
    onPointerUp: () => release(action),
    onPointerLeave: () => release(action),   // finger slides away
    onPointerCancel: () => release(action),  // browser gesture cancelled
  });

  return (
    <Flex align="center" gap={12}>
      <Grid
        gap={2}
      >
        {/* row 1, col 2  ── UP */}
        <GridItem colStart={2} rowStart={1}>
          <Kbd {...bind('up')}>&uarr;</Kbd>
        </GridItem>

        {/* row 2, col 1  ── LEFT */}
        <GridItem colStart={1} rowStart={2}>
          <Kbd {...bind('left')}>&larr;</Kbd>
        </GridItem>

        {/* row 2, col 2  ── DOWN */}
        <GridItem colStart={2} rowStart={2}>
          <Kbd {...bind('down')}>&darr;</Kbd>
        </GridItem>

        {/* row 2, col 3  ── RIGHT */}
        <GridItem colStart={3} rowStart={2}>
          <Kbd {...bind('right')}>&rarr;</Kbd>
        </GridItem>
      </Grid>
      <Button
        h={28}
        color={{ base: "black", _dark: "white" }}
        bg={{ base: "white", _dark: "black" }}
        border={{ base: "0.25rem solid black", _dark: "0.25rem solid white" }}
        borderRadius="full"
        aspectRatio={1}
        fontSize="2xl"
        touchAction="none"
        onContextMenu={e => e.preventDefault()}
        {...bind('grab')}
      >
        GRAB
      </Button>
    </Flex>
  );
};

export default GameController;
