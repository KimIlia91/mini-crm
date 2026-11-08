/*
 * Adapted from shadcn-admin (https://github.com/satnaing/shadcn-admin),
 * Copyright (c) 2024 Sat Naing, MIT License. See THIRD_PARTY_NOTICES.md.
 */
import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useParams } from 'react-router'

import { useViewer } from '@/entities/profile'
import { taskQueries, TaskStatusBadge } from '@/entities/task'
import { DeleteTaskButton, TaskFormDialog } from '@/features/manage-task'
import { cn, formatDateTime, useDocumentTitle, useReturnFocus } from '@/shared/lib'
import {
  ActionsMenu,
  Alert,
  AlertDescription,
  Button,
  Card,
  CardContent,
  CardHeader,
  PageHeader,
  PageLoader,
  textLinkClass,
} from '@/shared/ui'

import { TaskActions } from './task-actions'
import { ReworkNotice } from './rework-notice'
import { TaskHistory } from './task-history'

function TaskNotFound() {
  const { t } = useTranslation('task')
  useDocumentTitle(t('notFoundTitle'))
  return (
    <section className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <p aria-hidden="true" className="text-[7rem] leading-tight font-bold">
        {t('notFoundCode')}
      </p>
      <h1 className="text-2xl font-medium [overflow-wrap:anywhere]">{t('notFoundTitle')}</h1>
      <p className="text-muted-foreground">{t('notFoundDescription')}</p>
      <Button asChild className="mt-6">
        <Link to="/">{t('home')}</Link>
      </Button>
    </section>
  )
}

export function TaskPage() {
  const { t } = useTranslation('task')
  const { taskId = '' } = useParams()
  const viewer = useViewer()
  const [editOpen, setEditOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const { remember, onCloseAutoFocus } = useReturnFocus()
  const task = useQuery({ ...taskQueries.detail(taskId), enabled: taskId !== '' })
  useDocumentTitle(task.data?.title ?? '')

  if (task.isPending) {
    return <PageLoader />
  }
  if (task.isError && task.data === undefined) {
    return (
      <Alert variant="destructive" role="alert">
        <AlertDescription className="flex flex-wrap items-center gap-2">
          {t('loadError')}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              void task.refetch()
            }}
          >
            {t('retry')}
          </Button>
        </AlertDescription>
      </Alert>
    )
  }
  if (!task.data) return <TaskNotFound />

  const data = task.data
  const isManager = viewer.role === 'manager'

  return (
    <div className="flex min-w-0 flex-col gap-4 sm:gap-6">
      <PageHeader
        title={data.title}
        clamp
        titleSuffix={<TaskStatusBadge status={data.status} />}
        actions={
          <>
            <TaskActions task={data} viewer={viewer} />
            {isManager ? (
              <ActionsMenu
                label={t('actions')}
                editLabel={t('edit')}
                deleteLabel={t('delete')}
                onEdit={
                  data.status === 'accepted'
                    ? undefined
                    : (opener) => {
                        remember(opener)
                        setEditOpen(true)
                      }
                }
                onDelete={(opener) => {
                  remember(opener)
                  setDeleteOpen(true)
                }}
              />
            ) : null}
          </>
        }
      />
      {isManager ? (
        <>
          <TaskFormDialog
            mode="edit"
            task={{
              id: data.id,
              title: data.title,
              description: data.description,
              assigneeId: data.assignee_id,
            }}
            open={editOpen}
            onOpenChange={setEditOpen}
            onCloseAutoFocus={onCloseAutoFocus}
          />
          <DeleteTaskButton
            taskId={data.id}
            objectId={data.object_id}
            open={deleteOpen}
            onOpenChange={setDeleteOpen}
            onCloseAutoFocus={onCloseAutoFocus}
          />
        </>
      ) : null}

      {data.status === 'rework' ? <ReworkNotice taskId={data.id} /> : null}

      <div className="grid min-w-0 gap-4 lg:grid-cols-3">
        <Card className="min-w-0 lg:col-start-3 lg:row-span-2 lg:row-start-1">
          <CardHeader>
            <h2 className="text-base leading-snug font-medium">{t('details.title')}</h2>
          </CardHeader>
          <CardContent>
            <dl className="grid min-w-0 gap-3 text-sm">
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-muted-foreground">{t('details.object')}</dt>
                <dd>
                  <Link className={cn(textLinkClass, 'min-w-0')} to={`/objects/${data.object.id}`}>
                    {data.object.name}
                  </Link>
                </dd>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-muted-foreground">{t('details.assignee')}</dt>
                <dd className="[overflow-wrap:anywhere]">{data.assignee.full_name}</dd>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-muted-foreground">{t('details.author')}</dt>
                <dd className="[overflow-wrap:anywhere]">{data.author.full_name}</dd>
              </div>
              <div className="flex min-w-0 flex-col gap-0.5">
                <dt className="text-muted-foreground">{t('details.createdAt')}</dt>
                <dd>
                  <time dateTime={data.created_at}>{formatDateTime(data.created_at)}</time>
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
        <Card className="min-w-0 lg:col-span-2 lg:col-start-1">
          <CardHeader>
            <h2 className="text-base leading-snug font-medium">{t('description.title')}</h2>
          </CardHeader>
          <CardContent>
            {data.description ? (
              <p className="text-sm [overflow-wrap:anywhere] whitespace-pre-wrap">
                {data.description}
              </p>
            ) : (
              <p className="text-sm text-muted-foreground">{t('description.empty')}</p>
            )}
          </CardContent>
        </Card>
        <TaskHistory taskId={data.id} className="lg:col-span-2 lg:col-start-1" />
      </div>
    </div>
  )
}
