import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { zodResolver } from "@hookform/resolvers/zod";
import { Controller, useForm } from "react-hook-form";
import { AlertTriangle, ArrowLeft, Save } from "lucide-react";
import { z } from "zod";
import { COMPLAINT_TYPES } from "@shared/constants/domain";
import { SectionCard } from "@/components/ui/Cards";
import { Button } from "@/components/ui/Button";
import { Field, Select, Textarea } from "@/components/ui/Field";
import { Input } from "@/components/ui/Input";
import { PageHeader } from "@/components/ui/PageHeader";
import { useToast } from "@/components/ui/toast-context";
import { api } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useApiMutation, useAssignableUsers, useConfiguration, useMasterBootstrap, usePermissions } from "@/services/queries";
import { RelatedEmailsField } from "@/features/complaint/RelatedEmailsField";
import { hasOnlyValidRelatedEmails, parseRelatedEmails } from "@/lib/related-emails";

const formSchema = z.object({
  type: z.enum(COMPLAINT_TYPES),
  company: z.string().min(1, "Select a company"),
  receivedAt: z.string().min(1, "Received date and time is required"),
  priority: z.string().min(1, "Select a priority"),
  source: z.string().max(80).optional(),
  reportedBy: z.string().max(160).optional(),
  customer: z.string().max(160).optional(),
  customerContact: z.string().max(160).optional(),
  customerLocation: z.string().max(160).optional(),
  project: z.string().max(160).optional(),
  customerPO: z.string().max(80).optional(),
  product: z.string().max(160).optional(),
  batch: z.string().max(80).optional(),
  responsibleDept: z.string().optional(),
  internalDept: z.string().optional(),
  againstDept: z.string().optional(),
  category: z.string().min(1, "Select a category"),
  subCategory: z.string().max(120).optional(),
  description: z.string().min(10, "Describe the complaint in at least 10 characters"),
  owner: z.string().optional(),
  relatedEmails: z
    .string()
    .max(4000)
    .refine(hasOnlyValidRelatedEmails, "Enter valid email addresses separated by commas or new lines")
});

type FormValues = z.infer<typeof formSchema>;

type DuplicateHit = { number: string; receivedAt: string; customer?: string; product?: string };

export function NewComplaintPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const permissions = usePermissions();
  const master = useMasterBootstrap();
  const configuration = useConfiguration(undefined, "basic");
  const [duplicates, setDuplicates] = useState<DuplicateHit[]>([]);
  const [checkingDuplicates, setCheckingDuplicates] = useState(false);

  const companies = useMemo(
    () => (master.data?.companies ?? []).filter((company) => company.active),
    [master.data]
  );

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      type: "External",
      company: "",
      receivedAt: new Date().toISOString().slice(0, 16),
      priority: "",
      category: "",
      description: "",
      relatedEmails: ""
    }
  });

  const type = form.watch("type");
  const company = form.watch("company");
  const customer = form.watch("customer");
  const product = form.watch("product");
  const category = form.watch("category");
  const assignable = useAssignableUsers(company || undefined);

  useEffect(() => {
    if (!company && companies.length === 1) form.setValue("company", companies[0]._id);
  }, [companies, company, form]);

  useEffect(() => {
    const priorities = configuration.data?.priorities ?? [];
    if (!form.getValues("priority") && priorities.length > 0) {
      const medium = priorities.find((entry) => entry.name === "Medium") ?? priorities[0];
      form.setValue("priority", medium._id);
    }
  }, [configuration.data, form]);

  // Repeat pre-check uses the same server rules the create endpoint applies.
  useEffect(() => {
    const repeatTerm = (customer || product || "").trim();
    // Avoid an expensive server search for one- or two-character partial input while the user is typing.
    if (!company || !category || repeatTerm.length < 3) {
      setDuplicates([]);
      return;
    }
    const timer = window.setTimeout(async () => {
      setCheckingDuplicates(true);
      try {
        const search = new URLSearchParams({ company, category, pageSize: "5" });
        search.set("search", repeatTerm);
        const result = await api<{ items: DuplicateHit[] }>(`/api/complaints?${search.toString()}`);
        setDuplicates(result.items ?? []);
      } catch {
        setDuplicates([]);
      } finally {
        setCheckingDuplicates(false);
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [company, category, customer, product]);

  const createComplaint = useApiMutation<{ complaint: { _id: string; number: string } }, Record<string, unknown>>("POST", "/api/complaints", [["complaints"]]);

  const categories = (configuration.data?.categories ?? []).filter((entry) => entry.complaintType === type);
  const departments = master.data?.departments ?? [];

  async function onSubmit(values: FormValues) {
    try {
      const payload = {
        ...values,
        receivedAt: new Date(values.receivedAt).toISOString(),
        customer: type === "External" ? values.customer : "",
        responsibleDept: type === "External" ? values.responsibleDept : values.againstDept,
        internalDept: type === "Internal" ? values.internalDept : undefined,
        againstDept: type === "Internal" ? values.againstDept : undefined,
        // Employees without a portal login are prefixed "emp:" in the picker.
        owner: values.owner && !values.owner.startsWith("emp:") ? values.owner : undefined,
        ownerEmployee: values.owner?.startsWith("emp:") ? values.owner.slice(4) : undefined,
        relatedEmails: parseRelatedEmails(values.relatedEmails)
      };
      const result = await createComplaint.mutateAsync(payload);
      toast.success("Complaint registered", `${result.complaint.number} was created.`);
      navigate(`/complaints/${result.complaint._id}`);
    } catch (error) {
      toast.failure(error, "The complaint could not be registered");
    }
  }

  if (!permissions.can("complaint.create")) {
    return (
      <main className="p-6">
        <SectionCard title="Not permitted">
          <p className="text-sm text-slate-600">Your role does not include permission to register complaints.</p>
        </SectionCard>
      </main>
    );
  }

  return (
    <main className="pb-10">
      <PageHeader
        title="Register a complaint"
        description="The visible fields change with the complaint type. Every value is validated again on the server."
        actions={
          <Button variant="secondary" onClick={() => navigate("/complaints")}>
            <ArrowLeft className="h-4 w-4" />
            Back to list
          </Button>
        }
      />

      <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 p-3 sm:p-6">
        <SectionCard title="Classification">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Complaint type" required error={form.formState.errors.type?.message}>
              <Select {...form.register("type")}>
                {COMPLAINT_TYPES.map((entry) => (
                  <option key={entry} value={entry}>
                    {entry}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Company" required error={form.formState.errors.company?.message}>
              <Select {...form.register("company")}>
                <option value="">Select a company</option>
                {companies.map((entry) => (
                  <option key={entry._id} value={entry._id}>
                    {entry.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Received date and time" required error={form.formState.errors.receivedAt?.message}>
              <Input type="datetime-local" {...form.register("receivedAt")} />
            </Field>
            <Field label="Priority" required error={form.formState.errors.priority?.message} hint="Priority scales every TAT target.">
              <Select {...form.register("priority")}>
                {(configuration.data?.priorities ?? []).map((entry) => (
                  <option key={entry._id} value={entry._id}>
                    {entry.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Category" required error={form.formState.errors.category?.message}>
              <Select {...form.register("category")}>
                <option value="">Select a category</option>
                {categories.map((entry) => (
                  <option key={entry._id} value={entry.name}>
                    {entry.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Sub category">
              <Input {...form.register("subCategory")} placeholder="Optional" />
            </Field>
            <Field label="Source">
              <Input {...form.register("source")} placeholder="Email, call, site visit" />
            </Field>
            <Field label="Reported by">
              <Input {...form.register("reportedBy")} placeholder="Person who raised it" />
            </Field>
          </div>
        </SectionCard>

        {type === "External" ? (
          <SectionCard title="Customer details" description="Required for an external complaint.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Customer" required error={form.formState.errors.customer?.message}>
                <Input {...form.register("customer")} />
              </Field>
              <Field label="Customer contact">
                <Input {...form.register("customerContact")} />
              </Field>
              <Field label="Customer location">
                <Input {...form.register("customerLocation")} />
              </Field>
              <Field label="Project">
                <Input {...form.register("project")} />
              </Field>
              <Field label="Customer PO">
                <Input {...form.register("customerPO")} />
              </Field>
              <Field label="Product">
                <Input {...form.register("product")} />
              </Field>
              <Field label="Batch or serial">
                <Input {...form.register("batch")} />
              </Field>
              <Field label="Responsible department" required>
                <Select {...form.register("responsibleDept")}>
                  <option value="">Select a department</option>
                  {departments.map((entry) => (
                    <option key={entry._id} value={entry._id}>
                      {entry.name}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>
          </SectionCard>
        ) : (
          <SectionCard title="Internal complaint routing" description="Internal complaints are raised by one department against another.">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label="Raising department" required>
                <Select {...form.register("internalDept")}>
                  <option value="">Select a department</option>
                  {departments.map((entry) => (
                    <option key={entry._id} value={entry._id}>
                      {entry.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Against department" required>
                <Select {...form.register("againstDept")}>
                  <option value="">Select a department</option>
                  {departments.map((entry) => (
                    <option key={entry._id} value={entry._id}>
                      {entry.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="Product or process">
                <Input {...form.register("product")} />
              </Field>
              <Field label="Batch or reference">
                <Input {...form.register("batch")} />
              </Field>
            </div>
          </SectionCard>
        )}

        <SectionCard title="Description and ownership">
          <div className="grid gap-3 lg:grid-cols-3">
            <div className="lg:col-span-2">
              <Field label="Complaint description" required error={form.formState.errors.description?.message}>
                <Textarea rows={6} {...form.register("description")} placeholder="What happened, where, and what the customer or department observed" />
              </Field>
            </div>
            <div className="space-y-3">
              <Controller
                control={form.control}
                name="owner"
                render={({ field }) => (
                  <Field label="Complaint owner" hint="Defaults to you. Directory employees without a login are named as owner and emailed; you stay the accountable user.">
                    <Select value={field.value ?? ""} onChange={field.onChange}>
                      <option value="">Assign to me</option>
                      {(assignable.data?.users ?? []).map((user) => (
                        <option key={user.id} value={user.id}>
                          {user.name} {user.role ? `— ${user.role}` : ""}
                        </option>
                      ))}
                      {(assignable.data?.employees ?? []).length > 0 ? (
                        <optgroup label="Employee Directory (no portal login)">
                          {(assignable.data?.employees ?? []).map((employee) => (
                            <option key={employee.id} value={`emp:${employee.id}`}>
                              {employee.name} {employee.designation ? `— ${employee.designation}` : ""}
                            </option>
                          ))}
                        </optgroup>
                      ) : null}
                    </Select>
                  </Field>
                )}
              />
            </div>
            <div className="lg:col-span-3">
              <Controller
                control={form.control}
                name="relatedEmails"
                render={({ field, fieldState }) => (
                  <RelatedEmailsField value={field.value} onChange={field.onChange} error={fieldState.error?.message} />
                )}
              />
            </div>
          </div>
        </SectionCard>

        {duplicates.length > 0 ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              <div className="min-w-0">
                <p className="text-sm font-bold text-amber-900">
                  {duplicates.length} similar complaint(s) already exist for this company and category
                </p>
                <p className="mt-1 text-xs text-amber-800">
                  If the server confirms a match inside the repeat window this complaint will be flagged as a repeat automatically.
                </p>
                <ul className="mt-2 space-y-1 text-xs text-amber-900">
                  {duplicates.map((entry) => (
                    <li key={entry.number}>
                      <span className="font-semibold">{entry.number}</span> — {entry.customer || entry.product || "no customer"} on{" "}
                      {formatDate(entry.receivedAt)}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        ) : null}

        <div className="flex flex-wrap items-center justify-end gap-2">
          {checkingDuplicates ? <span className="text-xs text-slate-500">Checking for similar complaints</span> : null}
          <Button variant="secondary" type="button" onClick={() => navigate("/complaints")}>
            Cancel
          </Button>
          <Button type="submit" disabled={createComplaint.isPending}>
            <Save className="h-4 w-4" />
            {createComplaint.isPending ? "Registering" : "Register complaint"}
          </Button>
        </div>
      </form>
    </main>
  );
}
