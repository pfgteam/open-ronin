// Centre-square crop plan for avatar uploads. Pure arithmetic, no DOM: the
// client component feeds these numbers straight into
// ctx.drawImage(img, sx, sy, size, size, 0, 0, out, out).
//
// Never upscales — a 200px photo stays 200px rather than being blown up to
// 512 and looking worse than the original.

export function planSquareCrop(input: { width: number; height: number; max: number }): {
	sx: number;
	sy: number;
	size: number;
	out: number;
} {
	const size = Math.min(input.width, input.height);
	return {
		sx: Math.floor((input.width - size) / 2),
		sy: Math.floor((input.height - size) / 2),
		size,
		out: Math.min(size, input.max),
	};
}
