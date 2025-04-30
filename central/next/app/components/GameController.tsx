'use client';
import React from 'react';
import { Button, Flex, VStack, HStack, Grid, GridItem, ButtonProps, FlexProps } from '@chakra-ui/react';
import { useClaw } from '@/app/components/providers/ClawProvider';

type KbdProps =
  FlexProps &               // chakra styling props
  React.ButtonHTMLAttributes<HTMLButtonElement>; // onMouseDown, disabled, etc.

export const Kbd: React.FC<KbdProps> = ({ children, ...props }) => {
  return <Flex as="button" align="center" justify="center" border="0.25rem solid black" h={6} w={6} p={8} borderRadius="md" fontSize="6xl" {...props}>
    {children}
  </Flex>
}

const GameController: React.FC = () => {
  const { isPlaying, press, release } = useClaw();
  if (!isPlaying) return null;

  return (
    <Flex align="center" gap={12} mt={4}>
      <Grid
        gap={2}
      >
        {/* row 1, col 2  ── UP */}
        <GridItem colStart={2} rowStart={1}>
          <Kbd onMouseDown={() => press('up')} onMouseUp={() => release('up')} onMouseLeave={() => release('up')}>&uarr;</Kbd>
        </GridItem>

        {/* row 2, col 1  ── LEFT */}
        <GridItem colStart={1} rowStart={2}>
          <Kbd onMouseDown={() => press('left')} onMouseUp={() => release('left')} onMouseLeave={() => release('left')}>&larr;</Kbd>
        </GridItem>

        {/* row 2, col 2  ── DOWN */}
        <GridItem colStart={2} rowStart={2}>
          <Kbd onMouseDown={() => press('down')} onMouseUp={() => release('down')} onMouseLeave={() => release('down')}>&darr;</Kbd>
        </GridItem>

        {/* row 2, col 3  ── RIGHT */}
        <GridItem colStart={3} rowStart={2}>
          <Kbd onMouseDown={() => press('right')} onMouseUp={() => release('right')} onMouseLeave={() => release('right')}>&rarr;</Kbd>
        </GridItem>
      </Grid>
      <Button
        h={36}
        color="black"
        bg="white"
        border="0.25rem solid black"
        borderRadius="full"
        aspectRatio={1}
        fontSize="4xl"
        onMouseDown={() => press('grab')}
        onMouseUp={() => release('grab')}
        onMouseLeave={() => release('grab')}
      >
        GRAB
      </Button>
    </Flex>
  );
};

export default GameController;
