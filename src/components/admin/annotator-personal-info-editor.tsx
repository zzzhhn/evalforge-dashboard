"use client";

import { useState, useTransition } from "react";
import { Pencil, Check, X, User, Calendar, MapPin, GraduationCap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useLocale } from "@/lib/i18n/context";
import { updatePersonalInfo } from "@/app/(main)/admin/annotators/assignment-action";

const GENDER_OPTIONS_ZH = ["男", "女", "不愿透露"];
const GENDER_OPTIONS_EN = ["Male", "Female", "Prefer not to say"];
const AGE_OPTIONS = ["16-25", "26-35", "36-45", "46-55"];
const EDUCATION_OPTIONS_ZH = ["高中", "大专", "本科", "硕士", "博士"];
const EDUCATION_OPTIONS_EN = ["High school", "Associate", "Bachelor", "Master", "PhD"];

interface Props {
  userId: string;
  gender: string | null;
  ageRange: string | null;
  city: string | null;
  education: string | null;
}

export function AnnotatorPersonalInfoEditor({
  userId,
  gender,
  ageRange,
  city,
  education,
}: Props) {
  const { locale, t } = useLocale();
  const [editing, setEditing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [draft, setDraft] = useState({
    gender: gender ?? "",
    ageRange: ageRange ?? "",
    city: city ?? "",
    education: education ?? "",
  });

  const genderOpts = locale === "zh" ? GENDER_OPTIONS_ZH : GENDER_OPTIONS_EN;
  const eduOpts = locale === "zh" ? EDUCATION_OPTIONS_ZH : EDUCATION_OPTIONS_EN;

  function save() {
    startTransition(async () => {
      const res = await updatePersonalInfo(userId, {
        gender: draft.gender || null,
        ageRange: draft.ageRange || null,
        city: draft.city || null,
        education: draft.education || null,
      });
      if (res.status === "ok") setEditing(false);
      else alert(res.message);
    });
  }

  function cancel() {
    setDraft({
      gender: gender ?? "",
      ageRange: ageRange ?? "",
      city: city ?? "",
      education: education ?? "",
    });
    setEditing(false);
  }

  const fields = [
    {
      key: "gender" as const,
      icon: User,
      label: locale === "zh" ? "性别" : "Gender",
      value: gender,
      draft: draft.gender,
      setDraft: (v: string) => setDraft((d) => ({ ...d, gender: v })),
      options: genderOpts,
    },
    {
      key: "ageRange" as const,
      icon: Calendar,
      label: locale === "zh" ? "年龄段" : "Age range",
      value: ageRange,
      draft: draft.ageRange,
      setDraft: (v: string) => setDraft((d) => ({ ...d, ageRange: v })),
      options: AGE_OPTIONS,
    },
    {
      key: "city" as const,
      icon: MapPin,
      label: locale === "zh" ? "城市" : "City",
      value: city,
      draft: draft.city,
      setDraft: (v: string) => setDraft((d) => ({ ...d, city: v })),
      options: null,
    },
    {
      key: "education" as const,
      icon: GraduationCap,
      label: locale === "zh" ? "学历" : "Education",
      value: education,
      draft: draft.education,
      setDraft: (v: string) => setDraft((d) => ({ ...d, education: v })),
      options: eduOpts,
    },
  ];

  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="mb-3 flex items-center justify-between">
        <div className="text-sm font-medium">
          {locale === "zh" ? "人员信息" : "Personal info"}
        </div>
        {!editing ? (
          <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
            <Pencil className="h-3.5 w-3.5 mr-1" />
            {locale === "zh" ? "编辑" : "Edit"}
          </Button>
        ) : (
          <div className="flex gap-2">
            <Button variant="ghost" size="sm" onClick={cancel} disabled={pending}>
              <X className="h-3.5 w-3.5 mr-1" />
              {locale === "zh" ? "取消" : "Cancel"}
            </Button>
            <Button size="sm" onClick={save} disabled={pending}>
              <Check className="h-3.5 w-3.5 mr-1" />
              {pending
                ? locale === "zh" ? "保存中…" : "Saving…"
                : locale === "zh" ? "保存" : "Save"}
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        {fields.map((f) => {
          const Icon = f.icon;
          return (
            <div key={f.key} className="rounded-lg border bg-background/50 p-3">
              <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">
                <Icon className="h-3 w-3" />
                {f.label}
              </div>
              {!editing ? (
                <div className="mt-1 text-sm font-medium">
                  {f.value || <span className="text-muted-foreground">—</span>}
                </div>
              ) : f.options ? (
                <select
                  className="mt-1 w-full rounded-md border bg-background px-2 py-1 text-sm"
                  value={f.draft}
                  onChange={(e) => f.setDraft(e.target.value)}
                >
                  <option value="">—</option>
                  {f.options.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <Input
                  className="mt-1 h-8 text-sm"
                  value={f.draft}
                  onChange={(e) => f.setDraft(e.target.value)}
                  placeholder={locale === "zh" ? "输入…" : "Enter…"}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
