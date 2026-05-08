"use client";
import { Box, Drawer, VStack, HStack, Text, Tabs, IconButton, Portal, Skeleton, Flex, Icon } from "@chakra-ui/react"
import { useState } from "react";
import { useClaw } from "./providers";
import { ScrollArea } from '@/components/ui/scroll-area';
import { useAppKit, useAppKitAccount } from '@reown/appkit/react';
import { FiSettings } from 'react-icons/fi';
import { FaWallet } from "react-icons/fa";
import { RxCross2 } from "react-icons/rx";
import { useIsMobile } from "./hooks/useIsMobile";
import { parseTimestamp } from "@/lib/utils";
import Inventory from "./Inventory";

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
	triggerClassName?: string
}

export const AccountManager = (
	{ containerRef, triggerClassName }: AccountManagerProps
) => {
	const { address, isConnected } = useAppKitAccount();
	const { open } = useAppKit();
	const [drawerOpen, setDrawerOpen] = useState(false);
	const isMobile = useIsMobile();

	const { accountBalance, withdraw, withdrawing, accountBets, accountWithdrawals } = useClaw();
	if (!isConnected) return <Box w={"40px"} />

	return (
		<Drawer.Root
			placement={"top"}
			open={drawerOpen}
			onOpenChange={(e) => { setDrawerOpen(e.open) }}
		>
			<Drawer.Trigger asChild>
				{triggerClassName ? (
					<button className={triggerClassName} aria-label="Account">
						<FaWallet />
					</button>
				) : (
					<IconButton borderRadius={"full"}>
						<FaWallet />
					</IconButton>
				)}
			</Drawer.Trigger>
			<Portal container={containerRef}>
				<Drawer.Backdrop className="lg-drawer-backdrop" />
				<Drawer.Positioner pos={containerRef ? "absolute" : "fixed"} boxSize={"full"}>
					<Drawer.Content
						className="glass holo-rim"
						borderBottomRadius={"1.5rem"}
						borderTopRadius={isMobile ? "0" : "1.5rem"}
					>
						<button className="lg-drawer__close" onClick={() => setDrawerOpen(false)} aria-label="Close">✕</button>
						<Drawer.Body>
							<VStack gap={6} pt={2} pb={4}>
								<HStack justify="space-between" w="full" px={2}>
									<Text
										fontFamily="var(--lg-mono)"
										fontSize="sm"
										letterSpacing="0.05em"
										color="var(--ink-soft)"
									>
										{address?.slice(0, 6)}...{address?.slice(address.length - 4)}
									</Text>
									<button
										className="chip chip--circle holo-rim spec"
										onClick={(event) => { event.stopPropagation(); setDrawerOpen(false); open() }}
										aria-label="Settings"
									>
										<FiSettings />
									</button>
								</HStack>
								<Box
									fontSize="3xl"
									fontWeight="700"
									letterSpacing="-0.025em"
									color="var(--ink)"
									fontFamily="var(--lg-display)"
								>
									${accountBalance}
								</Box>
								<button
									className="lg-btn holo-rim spec"
									onClick={withdraw}
									disabled={accountBalance === 0 || withdrawing}
								>
									{withdrawing ? "Withdrawing…" : "WITHDRAW"}
								</button>
								<Tabs.Root
									lazyMount
									unmountOnExit
									defaultValue="Inventory"
									onClick={(event) => { event.stopPropagation() }}
									minW={"60%"}
								>
									<Tabs.List
										mb={2}
										borderBottom="0px"
										gap={4}
										justifyContent={"space-around"}
									>
										{['Inventory', 'Bets', 'Withdrawals'].map((label) => (
											<Tabs.Trigger
												key={label}
												value={label}
												color="var(--ink-soft)"
												borderBottomWidth="2px"
												borderBottomStyle="solid"
												borderBottomColor="transparent"
												fontSize="md"
												fontWeight="500"
												fontFamily="var(--lg-display)"
												_selected={{
													color: "var(--ink)",
													borderBottomColor: "var(--ink)",
												}}
											>
												{label}
											</Tabs.Trigger>
										))}
									</Tabs.List>
									<Tabs.Content value="Inventory" p={0}>
										<Inventory />
									</Tabs.Content>
									<Tabs.Content value="Bets" p={0}>
										<ScrollArea className='h-[100px]'>
											<VStack>
												{accountBets === null ?
													[1, 2, 3, 4].map((i) => <Skeleton key={i} w={"100%"} h={"1rem"} />) :
													!accountBets.length ?
														<Flex w={"100%"} minH={"4rem"} align="center" justify={"center"}>
															<Text>You have no settled bets</Text>
														</Flex> :
														accountBets.map((b, i) =>
															<HStack
																key={i}
																justify={"space-between"}
																w={"full"}
																paddingEnd={6}
															>
																<Text flex={1} textAlign={"start"}>{parseTimestamp(b.played_at)}</Text>
																<Text flex={1} textAlign={"center"}>${b.bet}</Text>
																<Text flex={1} textAlign={"end"}>{
																	b.win ?
																		`${b.multiplier / 100}x` :
																		<Icon color={"red"}>
																			<RxCross2 />
																		</Icon>
																}</Text>
															</HStack>
														)}
											</VStack>
										</ScrollArea>
									</Tabs.Content>
									<Tabs.Content value="Withdrawals" p={0}>
										<ScrollArea className='h-[100px]'>
											<VStack>
												{accountWithdrawals === null ?
													[1, 2, 3, 4].map((i) => <Skeleton key={i} w={"100%"} h={"1rem"} />) :
													!accountWithdrawals.length ?
														<Flex w={"100%"} minH={"4rem"} align="center" justify={"center"}>
															<Text>You have no withdrawals</Text>
														</Flex> :
														accountWithdrawals.map((w, i) =>
															<HStack
																key={i}
																justify={"space-between"}
																w={"full"}
																paddingEnd={6}
															>
																<Text>{parseTimestamp(w.timestamp)}</Text>
																<Text>${w.amount}</Text>
															</HStack>
														)}
											</VStack>
										</ScrollArea>
									</Tabs.Content>
								</Tabs.Root>
								{/* </VStack> */}
							</VStack>
						</Drawer.Body>
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