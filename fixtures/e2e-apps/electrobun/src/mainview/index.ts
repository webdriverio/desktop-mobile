export {};

const counterEl = document.getElementById('counter') as HTMLSpanElement;
const statusEl = document.getElementById('status') as HTMLDivElement;
const incrementButton = document.getElementById('increment-button') as HTMLButtonElement;
const decrementButton = document.getElementById('decrement-button') as HTMLButtonElement;
const resetButton = document.getElementById('reset-button') as HTMLButtonElement;

let count = 0;

function render(message: string): void {
  counterEl.textContent = String(count);
  statusEl.textContent = message;
}

incrementButton.addEventListener('click', () => {
  count += 1;
  render(`Incremented to ${count}`);
});

decrementButton.addEventListener('click', () => {
  count -= 1;
  render(`Decremented to ${count}`);
});

resetButton.addEventListener('click', () => {
  count = 0;
  render('Counter reset');
});

render('Application loaded successfully');
