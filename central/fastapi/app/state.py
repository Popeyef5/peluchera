# tiny shared-state module to avoid circular imports
sid_to_addr = {}
current_player = None
game_state = [0, 0]   # list so it’s mutable in-place
