"use client";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { MODULES } from "@/lib/access/modules";

export interface AccessEntity {
  id: string;
  name: string;
}

export interface AccessValue {
  /** null = every entity */
  entityIds: string[] | null;
  /** null = every module */
  modules: string[] | null;
}

export const FULL_ACCESS: AccessValue = { entityIds: null, modules: null };

const ORG_MODULES = MODULES.filter((m) => m.scope === "org");
const ENTITY_MODULES = MODULES.filter((m) => m.scope === "entity");

/** Human summary for the members table. */
export function describeAccess(
  value: AccessValue,
  entities: AccessEntity[]
): { entities: string; modules: string; restricted: boolean } {
  const restricted = value.entityIds !== null || value.modules !== null;
  const entityText =
    value.entityIds === null
      ? "All entities"
      : value.entityIds.length === 0
        ? "No entities"
        : value.entityIds
            .map((id) => entities.find((e) => e.id === id)?.name ?? "Unknown entity")
            .join(", ");
  const moduleText =
    value.modules === null
      ? "All modules"
      : value.modules.length === 0
        ? "No modules"
        : `${value.modules.length} of ${MODULES.length} modules`;
  return { entities: entityText, modules: moduleText, restricted };
}

interface AccessPickerProps {
  value: AccessValue;
  onChange: (next: AccessValue) => void;
  entities: AccessEntity[];
  /** Admins always have full access; the picker is disabled for them. */
  disabled?: boolean;
  idPrefix?: string;
}

export function AccessPicker({
  value,
  onChange,
  entities,
  disabled,
  idPrefix = "access",
}: AccessPickerProps) {
  const entityRestricted = value.entityIds !== null;
  const moduleRestricted = value.modules !== null;

  function toggleEntity(id: string, checked: boolean) {
    const current = value.entityIds ?? [];
    const next = checked ? [...current, id] : current.filter((x) => x !== id);
    onChange({ ...value, entityIds: next });
  }

  function toggleModule(key: string, checked: boolean) {
    const current = value.modules ?? [];
    const next = checked ? [...current, key] : current.filter((x) => x !== key);
    onChange({ ...value, modules: next });
  }

  if (disabled) {
    return (
      <p className="text-sm text-muted-foreground">
        Admins always have access to every entity and module.
      </p>
    );
  }

  return (
    <div className="space-y-5">
      {/* Entities */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Entities</Label>
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant={entityRestricted ? "outline" : "secondary"}
              onClick={() => onChange({ ...value, entityIds: null })}
            >
              All entities
            </Button>
            <Button
              type="button"
              size="sm"
              variant={entityRestricted ? "secondary" : "outline"}
              onClick={() => onChange({ ...value, entityIds: value.entityIds ?? [] })}
            >
              Only selected
            </Button>
          </div>
        </div>
        {entityRestricted && (
          <div className="grid grid-cols-2 gap-2 rounded-md border p-3">
            {entities.map((e) => {
              const id = `${idPrefix}-entity-${e.id}`;
              return (
                <div key={e.id} className="flex items-center gap-2">
                  <Checkbox
                    id={id}
                    checked={value.entityIds?.includes(e.id) ?? false}
                    onCheckedChange={(c) => toggleEntity(e.id, c === true)}
                  />
                  <Label htmlFor={id} className="text-sm font-normal cursor-pointer">
                    {e.name}
                  </Label>
                </div>
              );
            })}
            {entities.length === 0 && (
              <p className="text-sm text-muted-foreground col-span-2">No active entities.</p>
            )}
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          The member sees only the entities you pick, in the switcher and in every consolidated page.
        </p>
      </div>

      {/* Modules */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <Label className="text-sm font-medium">Modules</Label>
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant={moduleRestricted ? "outline" : "secondary"}
              onClick={() => onChange({ ...value, modules: null })}
            >
              All modules
            </Button>
            <Button
              type="button"
              size="sm"
              variant={moduleRestricted ? "secondary" : "outline"}
              onClick={() => onChange({ ...value, modules: value.modules ?? [] })}
            >
              Only selected
            </Button>
          </div>
        </div>
        {moduleRestricted && (
          <div className="grid grid-cols-2 gap-4 rounded-md border p-3">
            <ModuleColumn
              title="Organization"
              items={ORG_MODULES}
              selected={value.modules ?? []}
              onToggle={toggleModule}
              idPrefix={idPrefix}
            />
            <ModuleColumn
              title="Entity"
              items={ENTITY_MODULES}
              selected={value.modules ?? []}
              onToggle={toggleModule}
              idPrefix={idPrefix}
            />
          </div>
        )}
        <p className="text-xs text-muted-foreground">
          Unchecked modules disappear from the sidebar, and their pages redirect if opened by URL.
        </p>
      </div>
    </div>
  );
}

function ModuleColumn({
  title,
  items,
  selected,
  onToggle,
  idPrefix,
}: {
  title: string;
  items: typeof MODULES;
  selected: string[];
  onToggle: (key: string, checked: boolean) => void;
  idPrefix: string;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </p>
      {items.map((m) => {
        const id = `${idPrefix}-module-${m.key}`;
        return (
          <div key={m.key} className="flex items-start gap-2">
            <Checkbox
              id={id}
              className="mt-0.5"
              checked={selected.includes(m.key)}
              onCheckedChange={(c) => onToggle(m.key, c === true)}
            />
            <Label htmlFor={id} className="text-sm font-normal leading-tight cursor-pointer">
              {m.label}
              {m.hint && (
                <span className="block text-xs text-muted-foreground">{m.hint}</span>
              )}
            </Label>
          </div>
        );
      })}
    </div>
  );
}
