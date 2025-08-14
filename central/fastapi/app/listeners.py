import asyncio
from web3 import WebSocketProvider, AsyncWeb3
from web3.utils.subscriptions import LogsSubscription, LogsSubscriptionContext
from sqlalchemy import select
import websockets

from .abi import claw_abi
from .config import BASE_RPC_WS, CLAW_ADDRESS
from .db import async_session
from .models import QueueEntry, Round
from .socket.sio_instance import sio
from .state import game_state
from .logging import log


async def web3_listener():
    ws = WebSocketProvider(
        BASE_RPC_WS,
        websocket_kwargs={"ping_interval": 20, "ping_timeout": None},
    )

    while True:
        try:
            async with AsyncWeb3(ws) as w3:
                claw = w3.eth.contract(address=CLAW_ADDRESS, abi=claw_abi)

                # seed state
                game_state[:] = await claw.functions.gameState().call()

                # async def _save_raw(ctx, db, name: str, args: dict):
                #     bn = ctx.result["blockNumber"]
                #     blk = await w3.eth.get_block(bn)
                #     await upsert_block(
                #         db, number=bn, block_hash=blk.hash.hex(), ts=blk.timestamp
                #     )
                #     await upsert_event(
                #         db,
                #         block_number=bn,
                #         tx_hash=ctx.result["transactionHash"].hex(),
                #         log_index=ctx.result["logIndex"],
                #         address=ctx.result["address"],
                #         event_name=name,
                #         args=args,
                #         removed=bool(ctx.result.get("removed", False)),
                #     )

                # handlers
                async def _player_bet(ctx: LogsSubscriptionContext):
                    evt = claw.events.PlayerBet().process_log(ctx.result)
                    amount = evt["args"]["amount"]
                    game_state[0] += amount
                    await sio.emit("game_state", {"state": game_state})

                async def _player_win(ctx: LogsSubscriptionContext):
                    evt = claw.events.PlayerWin().process_log(ctx.result)
                    amount = evt["args"]["amount"]
                    address = evt["args"]["player"]
                    key_bytes = evt["args"]["sig"]
                    key_str = key_bytes.hex()

                    async with async_session() as db:
                        entry = await db.scalar(
                            select(QueueEntry)
                            .where(QueueEntry.key == key_str)
                            .where(QueueEntry.address == address)
                        )

                        if not entry:
                            log.warning("No matching QueueEntry for win log")
                            return
                        if entry.status != "played":
                            log.warning(
                                "The correspinging QueueEntry does not have the correct status"
                            )
                            return
                        if entry.win:
                            log.warning(
                                "The corresponding entry is already marked as won"
                            )
                            return

                        entry.win = True
                        await db.commit()

                    game_state[1] += amount
                    await sio.emit("game_state", {"state": game_state})

                async def _round_end(ctx: LogsSubscriptionContext):
                    log.info("Round end callback")
                    await sio.emit("round_end")
                    async with async_session() as db:
                        db.add(Round())
                        await db.commit()
                    game_state[:] = await claw.functions.gameState().call()
                    await sio.emit("game_state", {"state": game_state})

                await w3.subscription_manager.subscribe(
                    [
                        LogsSubscription(
                            label="player-bet",
                            address=claw.address,
                            topics=[claw.events.PlayerBet().topic],
                            handler=_player_bet,
                        ),
                        LogsSubscription(
                            label="player-win",
                            address=claw.address,
                            topics=[claw.events.PlayerWin().topic],
                            handler=_player_win,
                        ),
                        LogsSubscription(
                            label="round-end",
                            address=claw.address,
                            topics=[claw.events.RoundEnd().topic],
                            handler=_round_end,
                        ),
                        # ... add others here
                    ]
                )

                await w3.subscription_manager.handle_subscriptions()
        except asyncio.CancelledError:
            return
        except websockets.ConnectionClosedError as exc:
            log.warning("Lost WS: %s – reconnecting in %ss", exc, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)
        except Exception as e:
            log.warning(f"An exception occurred in the web3 listeners: {e}")
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 30)
