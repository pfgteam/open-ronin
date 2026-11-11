import { describe, expect, it } from 'vitest';
import { vttToText } from './ai';

describe('vttToText', () => {
	it('drops headers, cue numbers and timestamps', () => {
		const vtt = 'WEBVTT\n\n1\n00:00:01.000 --> 00:00:03.000\nHello there\n\n2\n00:00:03.500 --> 00:00:05.000\nHow are you\n';
		expect(vttToText(vtt)).toBe('Hello there\nHow are you');
	});
});
