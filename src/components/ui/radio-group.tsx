import * as React from "react";

import { cn } from "@/lib/utils";

type RadioContextValue = {
  value?: string;
  onValueChange?: (value: string) => void;
  name: string;
};

const RadioContext = React.createContext<RadioContextValue>({
  name: "radio-group",
});

function RadioGroup({
  value,
  onValueChange,
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  value?: string;
  onValueChange?: (value: string) => void;
}) {
  const name = React.useId();
  return (
    <RadioContext.Provider value={{ value, onValueChange, name }}>
      <div className={cn("grid gap-2", className)} {...props} />
    </RadioContext.Provider>
  );
}

const RadioGroupItem = React.forwardRef<
  HTMLInputElement,
  Omit<React.InputHTMLAttributes<HTMLInputElement>, "type"> & { value: string }
>(({ className, value, ...props }, ref) => {
  const ctx = React.useContext(RadioContext);
  return (
    <input
      ref={ref}
      type="radio"
      name={ctx.name}
      value={value}
      checked={ctx.value === value}
      onChange={() => ctx.onValueChange?.(value)}
      className={cn("h-3.5 w-3.5 accent-primary", className)}
      {...props}
    />
  );
});
RadioGroupItem.displayName = "RadioGroupItem";

export { RadioGroup, RadioGroupItem };
