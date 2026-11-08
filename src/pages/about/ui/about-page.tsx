import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { Building2Icon, ExternalLinkIcon } from 'lucide-react'
import { Link } from 'react-router'

import { useSession } from '@/shared/auth'
import { useDocumentTitle } from '@/shared/lib'
import { Button, PageHeader, SkipToMain, textLinkClass } from '@/shared/ui'

const AUTHOR_EMAIL = 'paterfamelias@gmail.com'
const AUTHOR_TELEGRAM = 'Kor2710'
const ASSIGNMENT_URL =
  'https://docs.google.com/document/d/1dpyRJ1E__eD0cisYSj0GDml4xtTTPaLe/edit?usp=sharing'
const VIDEO_SRC = '/media/mini-crm-demo.mp4'
const VIDEO_POSTER = '/media/mini-crm-demo-poster.jpg'
const VIDEO_CAPTIONS = '/media/mini-crm-demo.ru.vtt'

const H2 = 'text-xl font-semibold [overflow-wrap:anywhere]'
const H3 = 'text-base font-semibold [overflow-wrap:anywhere]'
const UL = 'list-disc space-y-1 ps-5'
const OL = 'list-decimal space-y-1 ps-5'

function List({ items, ordered = false }: { items: readonly string[]; ordered?: boolean }) {
  const Tag = ordered ? 'ol' : 'ul'
  return (
    <Tag className={ordered ? OL : UL}>
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </Tag>
  )
}

function HeaderAction() {
  const { t } = useTranslation('about')
  const session = useSession()
  return (
    <div className="flex min-h-9 items-center">
      {session.status === 'signed-out' ? (
        <Button asChild>
          <Link to="/login">{t('header.signIn')}</Link>
        </Button>
      ) : session.status === 'signed-in' ? (
        <Button asChild variant="outline">
          <Link to="/">{t('header.toApp')}</Link>
        </Button>
      ) : null}
    </div>
  )
}

/** Public «About» page: roles, task flow, security and a demo video. Needs no data, only the session. */
export function AboutPage() {
  const { t } = useTranslation('about')
  const { t: tc } = useTranslation('common')
  useDocumentTitle(t('title'))
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [])

  return (
    <>
      <SkipToMain />
      <header className="mx-auto flex w-full max-w-3xl flex-wrap items-center justify-between gap-2 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="flex size-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Building2Icon className="size-5" aria-hidden="true" />
          </span>
          <span className="text-xl font-medium">{tc('appName')}</span>
        </div>
        <HeaderAction />
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 pt-6 pb-12 outline-none"
      >
        <div className="flex flex-col gap-3">
          <PageHeader title={t('title')} description={t('lead')} />
          <p>
            {t('assignment.text')}{' '}
            <a href={ASSIGNMENT_URL} target="_blank" rel="noreferrer" className={textLinkClass}>
              {t('assignment.link')}
              <ExternalLinkIcon
                className="ms-1 inline size-4 align-[-0.125em]"
                aria-hidden="true"
              />
              <span className="sr-only"> {t('assignment.newTab')}</span>
            </a>
          </p>
          <p className="text-sm text-muted-foreground">{t('demoAccess')}</p>
        </div>

        <section className="flex flex-col gap-3">
          <h2 className={H2}>{t('author.title')}</h2>
          <p>{t('author.intro')}</p>
          <ul className={UL}>
            <li>
              {t('author.email')}:{' '}
              <a href={`mailto:${AUTHOR_EMAIL}`} className={textLinkClass}>
                {AUTHOR_EMAIL}
              </a>
            </li>
            <li>
              {t('author.telegram')}:{' '}
              <a
                href={`https://t.me/${AUTHOR_TELEGRAM}`}
                target="_blank"
                rel="noreferrer"
                className={textLinkClass}
              >
                @{AUTHOR_TELEGRAM}
                <ExternalLinkIcon
                  className="ms-1 inline size-4 align-[-0.125em]"
                  aria-hidden="true"
                />
                <span className="sr-only"> {t('author.newTab')}</span>
              </a>
            </li>
          </ul>
        </section>

        <section className="flex flex-col gap-3">
          <h2 className={H2}>{t('video.title')}</h2>
          <video
            controls
            preload="none"
            poster={VIDEO_POSTER}
            src={VIDEO_SRC}
            width={1280}
            height={720}
            aria-label={t('video.label')}
            className="aspect-video h-auto w-full rounded-lg border bg-muted object-contain"
          >
            <track kind="captions" srcLang="ru" label={t('video.captions')} src={VIDEO_CAPTIONS} />
          </video>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className={H2}>{t('roles.title')}</h2>
          <h3 className={H3}>{t('roles.manager.title')}</h3>
          <List items={t('roles.manager.items', { returnObjects: true })} />
          <h3 className={H3}>{t('roles.executor.title')}</h3>
          <List items={t('roles.executor.items', { returnObjects: true })} />
          <h3 className={H3}>{t('roles.executorCannot.title')}</h3>
          <List items={t('roles.executorCannot.items', { returnObjects: true })} />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className={H2}>{t('flow.title')}</h2>
          <p>{t('flow.intro')}</p>
          <List items={t('flow.items', { returnObjects: true })} />
          <p>{t('flow.note')}</p>
        </section>

        <section className="flex flex-col gap-4">
          <h2 className={H2}>{t('guide.title')}</h2>
          <h3 className={H3}>{t('guide.manager.title')}</h3>
          <List ordered items={t('guide.manager.steps', { returnObjects: true })} />
          <p>{t('guide.manager.note')}</p>
          <h3 className={H3}>{t('guide.executor.title')}</h3>
          <List ordered items={t('guide.executor.steps', { returnObjects: true })} />
        </section>

        <section className="flex flex-col gap-4">
          <h2 className={H2}>{t('notifications.title')}</h2>
          <p>{t('notifications.intro')}</p>
          <h3 className={H3}>{t('notifications.executor.title')}</h3>
          <List items={t('notifications.executor.items', { returnObjects: true })} />
          <h3 className={H3}>{t('notifications.manager.title')}</h3>
          <List items={t('notifications.manager.items', { returnObjects: true })} />
          <List items={t('notifications.rules', { returnObjects: true })} />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className={H2}>{t('design.title')}</h2>
          {t('design.paragraphs', { returnObjects: true }).map((text) => (
            <p key={text}>{text}</p>
          ))}
        </section>

        <section className="flex flex-col gap-3">
          <h2 className={H2}>{t('security.title')}</h2>
          <p>{t('security.intro')}</p>
          <List items={t('security.items', { returnObjects: true })} />
        </section>

        <section className="flex flex-col gap-3">
          <h2 className={H2}>{t('decisions.title')}</h2>
          <p>{t('decisions.intro')}</p>
          <List ordered items={t('decisions.items', { returnObjects: true })} />
          <h3 className={H3}>{t('decisions.notDone.title')}</h3>
          <List items={t('decisions.notDone.items', { returnObjects: true })} />
        </section>
      </main>
    </>
  )
}
