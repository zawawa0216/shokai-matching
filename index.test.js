const { add, subtract, multiply, divide } = require('./index')

test.each([
  [1, 2, 3],
  [-1, 1, 0],
])('add(%i, %i) === %i', (a, b, expected) => {
  expect(add(a, b)).toBe(expected)
})

test.each([
  [5, 3, 2],
  [0, 5, -5],
])('subtract(%i, %i) === %i', (a, b, expected) => {
  expect(subtract(a, b)).toBe(expected)
})

test.each([
  [3, 4, 12],
  [-2, 5, -10],
])('multiply(%i, %i) === %i', (a, b, expected) => {
  expect(multiply(a, b)).toBe(expected)
})

test('divide', () => {
  expect(divide(10, 2)).toBe(5)
  expect(() => divide(1, 0)).toThrow('Division by zero')
})
