from web3 import WebSocketProvider, AsyncWeb3
from web3.utils.subscriptions import LogsSubscription, LogsSubscriptionContext

from .abi import claw_abi
from .config import BASE_RPC_WS, CLAW_ADDRESS
from .socket.sio_instance import sio
from .state import game_state

async def web3_listener():
    ws = WebSocketProvider(
        BASE_RPC_WS,
        websocket_kwargs={"ping_interval": 20, "ping_timeout": None},
    )
    
    async with AsyncWeb3(ws) as w3:
        claw = w3.eth.contract(address=CLAW_ADDRESS, abi=claw_abi)

        # seed state
        game_state[:] = await claw.functions.gameState().call()

        # handlers
        async def _player_bet(ctx: LogsSubscriptionContext):
            evt = claw.events.PlayerBet().process_log(ctx.result)
            amount = evt["args"]["amount"]
            game_state[0] += amount
            await sio.emit("game_state", {"state": game_state})
            
        async def _player_win(ctx: LogsSubscriptionContext):
            evt = claw.events.PlayerWin().process_log(ctx.result)
            amount = evt["args"]["amount"]
            game_state[1] += amount
            await sio.emit("game_state", {"state": game_state})
        
        async def _round_end(ctx: LogsSubscriptionContext):
            game_state[:] = await claw.functions.gameState().call()
            await sio.emit("game_state", {"state": game_state})

        await w3.subscription_manager.subscribe([
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
        ])
        
        await w3.subscription_manager.handle_subscriptions()
