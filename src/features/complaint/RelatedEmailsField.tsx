import { Field, Textarea } from "@/components/ui/Field";

export function RelatedEmailsField({
  value,
  onChange,
  disabled = false,
  error
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  error?: string;
}) {
  return (
    <Field
      label="Related people email IDs"
      hint="Separate multiple company email addresses with commas or new lines. They receive every automated email about this complaint and its CAPAs; no portal account is required."
      error={error}
    >
      <Textarea
        rows={3}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
        placeholder="person.one@onepws.com, person.two@wmspl.co.in"
      />
    </Field>
  );
}
