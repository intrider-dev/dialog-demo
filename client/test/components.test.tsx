import { render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { Button, buttonVariants } from '../src/components/ui/button'
import { Badge, badgeVariants } from '../src/components/ui/badge'
import { Input } from '../src/components/ui/input'
import { Label } from '../src/components/ui/label'
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '../src/components/ui/card'
import { cn } from '../src/lib/utils'

it('renders each installed component and keeps labels, disabled state and composition', () => {
  render(
    <Card>
      <CardHeader>
        <CardTitle>Title</CardTitle>
        <CardDescription>Description</CardDescription>
        <CardAction>
          <Badge>Ready</Badge>
        </CardAction>
      </CardHeader>
      <CardContent>
        <Label htmlFor="field">Name</Label>
        <Input id="field" />
        <Button disabled>Disabled</Button>
        <Button asChild>
          <a href="#next">Next</a>
        </Button>
      </CardContent>
      <CardFooter>Footer</CardFooter>
    </Card>,
  )
  expect(screen.getByLabelText('Name')).toBeInTheDocument()
  expect(screen.getByRole('button')).toBeDisabled()
  expect(screen.getByRole('link')).toHaveAttribute('href', '#next')
  expect(buttonVariants({ variant: 'outline' })).toContain('border')
  expect(badgeVariants({ variant: 'secondary' })).toContain('secondary')
  expect(cn('px-2', false, 'px-4')).toContain('px-4')
})
