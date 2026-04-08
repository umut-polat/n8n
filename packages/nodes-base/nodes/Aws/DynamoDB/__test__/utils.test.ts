import { adjustPutItem } from '../utils';

describe('adjustPutItem', () => {
	it('keeps regular strings as S', () => {
		expect(adjustPutItem({ name: 'hello' })).toEqual({
			name: { S: 'hello' },
		});
	});

	it('parses numeric strings as N when autoParseNumbers is enabled', () => {
		expect(adjustPutItem({ id: '34', executionId: '1234567890' }, true)).toEqual({
			id: { N: '34' },
			executionId: { N: '1234567890' },
		});
	});

	it('keeps numeric strings as S when autoParseNumbers is disabled', () => {
		expect(adjustPutItem({ id: '34', executionId: '1234567890' }, false)).toEqual({
			id: { S: '34' },
			executionId: { S: '1234567890' },
		});
	});

	it('maps numbers to N', () => {
		expect(adjustPutItem({ count: 42, price: 9.99 })).toEqual({
			count: { N: '42' },
			price: { N: '9.99' },
		});
	});

	it('maps booleans to BOOL', () => {
		expect(adjustPutItem({ active: true })).toEqual({
			active: { BOOL: 'true' },
		});
	});

});
