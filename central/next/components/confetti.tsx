import confetti from "canvas-confetti";

function celebrate() {
	// Trigger massive confetti celebration
	const duration = 5000;
	const animationEnd = Date.now() + duration;
	
	const interval = setInterval(() => {
		const timeLeft = animationEnd - Date.now();
		
		if (timeLeft <= 0) {
			clearInterval(interval);
			return;
		}

		const particleCount = 50 * (timeLeft / duration);
		
		// Left side confetti
		confetti({
			particleCount,
			angle: 60,
			spread: 55,
			origin: { x: 0 },
			zIndex: 10000,
			colors: ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57']
		});
		
		// Right side confetti
		confetti({
			particleCount,
			angle: 120,
			spread: 55,
			origin: { x: 1 },
			zIndex: 10000,
			colors: ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57']
		});
		
		// Center confetti
		confetti({
			particleCount: particleCount * 0.5,
			spread: 100,
			origin: { y: 0.2 },
			zIndex: 10000,
			colors: ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57']
		});
	}, 200);

	// Initial burst
	confetti({
		particleCount: 100,
		spread: 160,
		origin: { y: 0.3 },
		zIndex: 10000,
		colors: ['#FFD700', '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', '#FECA57']
	});
}

export default celebrate;