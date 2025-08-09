"use client";
import { Box, Drawer, VStack, HStack, Text, Tabs, Button, IconButton, Portal } from "@chakra-ui/react"
import { useState } from "react";
import { useClaw } from "./providers";
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAppKit, useAppKitAccount } from '@reown/appkit/react';
import { FiSettings } from 'react-icons/fi';
import { FaWallet } from "react-icons/fa";
import { useIsMobile } from "./hooks/useIsMobile";

// const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

// export const AccountManagerDefault = () => {
// 	const { address, isConnected } = useAppKitAccount();
// 	const { open } = useAppKit();

// 	const { accountBalance, withdraw } = useClaw();

// 	const { open: isOpen, onToggle } = useDisclosure();
// 	const [showAccount, setShowAccount] = useState(false);
// 	const [showSummary, setShowSummary] = useState(true);
// 	const [grow, setGrow] = useState(false);

// 	useEffect(() => {
// 		const onGrow = async () => {
// 			setShowSummary(false);
// 			await delay(50);

// 			setGrow(true); // second step
// 			await delay(550);

// 			setShowAccount(true); // third step
// 		};

// 		const onShrink = async () => {
// 			setShowAccount(false);
// 			await delay(50);

// 			setGrow(false);
// 			await delay(550);

// 			setShowSummary(true)
// 		}

// 		if (isOpen) {
// 			onGrow();
// 		} else {
// 			onShrink();
// 		}
// 	}, [isOpen])

// 	if (!isConnected) {
// 		return <Box w={"36px"} />;
// 	}

// 	return <Box position="relative" h="full" minW={"36px"}>
// 		<Flex
// 			cursor="pointer"
// 			position="absolute"
// 			top={4}
// 			right={2}
// 			bg={{ base: "black", _dark: "white" }}
// 			color={{ base: "white", _dark: "black" }}
// 			borderRadius="1rem"
// 			w="fit-content"
// 			transition="all 0.5s ease-in-out"
// 			align="center"
// 			justify="center"
// 			py={grow ? 8 : 3}
// 			px={8}
// 			zIndex={100}
// 		>
// 			<VStack gap={grow ? 4 : 0}>
// 				<HStack onClick={onToggle}>
// 					<Text mr={grow ? "5rem" : "0"} fontSize={grow ? 'x-large' : 'large'} transition="margin 0.5s ease-in-out, font-size 0.5s ease">{address?.slice(0, 6)}...{address?.slice(address.length - 4)}</Text>
// 					<Icon onClick={(event) => { event.stopPropagation(); open() }} opacity={showAccount ? 1 : 0} transition="opacity 0.1s ease">
// 						<FiSettings />
// 					</Icon>
// 					<Text opacity={showSummary ? 1 : 0} transition="opacity 0.1s ease">${accountBalance}</Text>
// 				</HStack>
// 				<VStack gap={6} maxH={grow ? "100vh" : "0px"} opacity={showAccount ? 1 : 0} transition="opacity 0.1s ease, max-height 0.5s ease-in-out">
// 					<Box fontSize={'xx-large'}>${accountBalance}</Box>
// 					<Button
// 						bg={{ base: "white", _dark: "black" }}
// 						color={{ base: "black", _dark: "white" }}
// 						onClick={withdraw}
// 						h={12}
// 						w={40}
// 						fontWeight={"500"}
// 						fontSize={"md"}
// 						borderRadius={"1rem"}
// 						loading={true}
// 					>
// 						WITHDRAW
// 					</Button>
// 					<Tabs.Root lazyMount unmountOnExit defaultValue="Bets" onClick={(event) => { event.stopPropagation() }}>
// 						<Tabs.List mb={2} borderBottom="0px" gap={4} justifyContent={"space-around"}>
// 							{['Bets', 'Withdrawals'].map((label) => (
// 								<Tabs.Trigger
// 									key={label}
// 									value={label}
// 									color="gray.400"
// 									borderBottom={{ base: '4px solid black', _dark: '4px solid white' }}
// 									fontSize={"md"}
// 									_selected={{
// 										borderBottom: { base: '4px solid white', _dark: '4px solid black' },
// 										color: { base: 'white', _dark: 'black' },
// 									}}
// 								>
// 									{label}
// 								</Tabs.Trigger>
// 							))}
// 						</Tabs.List>
// 						<Tabs.Content value="Bets" p={0}>
// 							<ScrollArea className='h-[100px]'>
// 								<VStack>
// 									{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) =>
// 										<HStack key={i} justify={"space-between"} w={"full"} minW={grow ? 80 : 0} paddingEnd={6}><Text>Apr 2</Text><Text>$5</Text><Text>2x</Text></HStack>
// 									)}
// 								</VStack>
// 							</ScrollArea>
// 						</Tabs.Content>
// 						<Tabs.Content value="Withdrawals" p={0}>
// 							<ScrollArea className='h-[100px]'>
// 								<VStack>
// 									{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) =>
// 										<HStack key={i} justify={"space-between"} w={"full"} minW={grow ? 80 : 0} paddingEnd={6}><Text>Apr 2</Text><Text>$25</Text></HStack>
// 									)}
// 								</VStack>
// 							</ScrollArea>
// 						</Tabs.Content>
// 					</Tabs.Root>
// 				</VStack>
// 			</VStack>
// 		</Flex>
// 	</Box >
// }

interface AccountManagerProps {
	containerRef?: React.RefObject<HTMLElement | null>
}

export const AccountManager = (
	{ containerRef }: AccountManagerProps
) => {
	const { address, isConnected } = useAppKitAccount();
	const { open } = useAppKit();
	const [drawerOpen, setDrawerOpen] = useState(false);
	const isMobile = useIsMobile();

	const { accountBalance, withdraw, withdrawing } = useClaw();
	if (!isConnected) return <Box w={"40px"} />

	return (
		<Drawer.Root
			placement={"top"}
			// closeOnInteractOutside={false}
			open={drawerOpen}
			onOpenChange={(e) => { setDrawerOpen(e.open) }}
		>
			<Drawer.Trigger asChild>
				<IconButton borderRadius={"full"}>
					<FaWallet />
				</IconButton>
			</Drawer.Trigger>
			<Portal container={containerRef}>
				<Drawer.Backdrop />
				<Drawer.Positioner pos={"absolute"} boxSize={"full"}>
					<Drawer.Content
						borderBottomRadius={"1.5rem"}
						borderTopRadius={isMobile ? "0" : "1.5rem"}
						color={{ base: "white", _dark: "black" }}
						backgroundColor={{ base: "black", _dark: "white" }}
					>
						<Drawer.Header>
							{/* <Drawer.Title>Drawer Title</Drawer.Title> */}
						</Drawer.Header>
						<Drawer.Body >
							<VStack gap={8}>
								<HStack>
									<Text mr={"5rem"} fontSize={'x-large'} >{address?.slice(0, 6)}...{address?.slice(address.length - 4)}</Text>
									<IconButton
										onClick={(event) => { event.stopPropagation(); setDrawerOpen(false); open() }}
										size={"md"}
										rounded={"full"}
										variant={"ghost"}
										color={{ base: "white", _dark: "black" }}
										_hover={{ color: { base: "black", _dark: "white" } }}
									>
										<FiSettings />
									</IconButton>
								</HStack>
								{/* <VStack gap={6}> */}
								<Box fontSize={'xx-large'}>${accountBalance}</Box>
								<Button
									bg={{ base: "white", _dark: "black" }}
									color={{ base: "black", _dark: "white" }}
									onClick={withdraw}
									h={12}
									w={40}
									fontWeight={"500"}
									fontSize={"md"}
									borderRadius={"1rem"}
									loading={withdrawing}
									disabled={accountBalance === 0}
								>
									WITHDRAW
								</Button>
								<Tabs.Root
									lazyMount
									unmountOnExit
									defaultValue="Bets"
									onClick={(event) => { event.stopPropagation() }}
									minW={"60%"}
								>
									<Tabs.List
										mb={2}
										borderBottom="0px"
										gap={4}
										justifyContent={"space-around"}
									>
										{['Bets', 'Withdrawals'].map((label) => (
											<Tabs.Trigger
												key={label}
												value={label}
												color="gray.400"
												borderBottom={{ base: '4px solid black', _dark: '4px solid white' }}
												fontSize={"md"}
												_selected={{
													borderBottom: { base: '4px solid white', _dark: '4px solid black' },
													color: { base: 'white', _dark: 'black' },
												}}
											>
												{label}
											</Tabs.Trigger>
										))}
									</Tabs.List>
									<Tabs.Content value="Bets" p={0}>
										<ScrollArea className='h-[100px]'>
											<VStack>
												{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) =>
													<HStack key={i} justify={"space-between"} w={"full"} paddingEnd={6}><Text>Apr 2</Text><Text>$5</Text><Text>2x</Text></HStack>
												)}
											</VStack>
										</ScrollArea>
									</Tabs.Content>
									<Tabs.Content value="Withdrawals" p={0}>
										<ScrollArea className='h-[100px]'>
											<VStack>
												{[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((i) =>
													<HStack key={i} justify={"space-between"} w={"full"} paddingEnd={6}><Text>Apr 2</Text><Text>$25</Text></HStack>
												)}
											</VStack>
										</ScrollArea>
									</Tabs.Content>
								</Tabs.Root>
								{/* </VStack> */}
							</VStack>
						</Drawer.Body>
						<Drawer.Footer>
							{/* <Drawer.Title>Drawer Title</Drawer.Title> */}
						</Drawer.Footer>
					</Drawer.Content>
				</Drawer.Positioner>
			</Portal>
		</Drawer.Root>
	)
}

// const AccountManager = () => {
// 	const isMobile = useIsMobile();

// 	return isMobile ? <AccountManagerMobile /> : <AccountManagerDefault />
// }

export default AccountManager;