import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './button';

describe('Button', () => {
  it('renders its label and fires onClick', async () => {
    const onClick = jest.fn();
    render(<Button onClick={onClick}>Save</Button>);

    const button = screen.getByRole('button', { name: 'Save' });
    await userEvent.click(button);

    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('is disabled and busy while loading', () => {
    render(<Button loading>Saving</Button>);
    const button = screen.getByRole('button', { name: /Saving/ });

    expect(button).toBeDisabled();
    expect(button).toHaveAttribute('aria-busy', 'true');
  });

  it('applies variant and size classes', () => {
    render(
      <Button variant="danger" size="sm">
        Delete
      </Button>,
    );
    const button = screen.getByRole('button', { name: 'Delete' });

    expect(button.className).toMatch(/bg-error/);
    expect(button.className).toMatch(/h-9/);
  });
});