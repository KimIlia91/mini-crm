import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'

import { SessionContext, type SessionState } from '@/shared/auth'

import { expectNoAxeViolations } from '../../../../tests/setup/axe'
import { AboutPage } from './about-page'

const SIGNED_OUT: SessionState = { status: 'signed-out', userId: null }
const SIGNED_IN: SessionState = { status: 'signed-in', userId: 'u1' }
const LOADING: SessionState = { status: 'loading', userId: null }

function renderAbout(session: SessionState) {
  return render(
    <SessionContext value={session}>
      <MemoryRouter initialEntries={['/about']}>
        <AboutPage />
      </MemoryRouter>
    </SessionContext>,
  )
}

describe('AboutPage', () => {
  it('has one h1 and the sections in order', () => {
    renderAbout(SIGNED_OUT)
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1)
    expect(screen.getByRole('heading', { level: 1, name: 'О проекте' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
      'Автор',
      'Видео-обзор',
      'Роли',
      'Путь задачи',
      'Как работать',
      'Обновления и уведомления',
      'Как устроено',
      'Как защищены данные',
      'Решения и допущения',
    ])
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Постановщик',
      'Исполнитель',
      'Чего не может исполнитель',
      'Постановщик',
      'Исполнитель',
      'Что приходит исполнителю',
      'Что приходит постановщику',
      'Чего нет',
    ])
  })

  it('describes live updates and notifications', () => {
    renderAbout(SIGNED_OUT)
    expect(screen.getByText(/появляются на экране без перезагрузки/)).toBeInTheDocument()
    expect(screen.getByText('Задачу передали другому исполнителю.')).toBeInTheDocument()
    expect(screen.getByText('Исполнитель отправил задачу на проверку.')).toBeInTheDocument()
    expect(screen.getByText(/Принята: имя/)).toBeInTheDocument()
    expect(screen.getByText(/Комментарий постановщика к возврату/)).toBeInTheDocument()
    expect(screen.getByText(/Supabase Realtime/)).toBeInTheDocument()
    expect(screen.getByText(/в любом случае в течение минуты/)).toBeInTheDocument()
    expect(screen.getByText(/старше 90 дней/)).toBeInTheDocument()
    expect(screen.getByText(/push-сообщений и писем нет/)).toBeInTheDocument()
  })

  it('offers «Войти» to /login when signed out', () => {
    renderAbout(SIGNED_OUT)
    expect(screen.getByRole('link', { name: 'Войти' })).toHaveAttribute('href', '/login')
    expect(screen.queryByRole('link', { name: 'К приложению' })).not.toBeInTheDocument()
  })

  it('offers «К приложению» to / when signed in', () => {
    renderAbout(SIGNED_IN)
    expect(screen.getByRole('link', { name: 'К приложению' })).toHaveAttribute('href', '/')
    expect(screen.queryByRole('link', { name: 'Войти' })).not.toBeInTheDocument()
  })

  it('shows no header action while the session loads', () => {
    renderAbout(LOADING)
    expect(screen.queryByRole('link', { name: 'Войти' })).not.toBeInTheDocument()
    expect(screen.queryByRole('link', { name: 'К приложению' })).not.toBeInTheDocument()
  })

  it('renders a click-to-load video with captions and no autoplay', () => {
    renderAbout(SIGNED_OUT)
    const video = screen.getByLabelText('Видео-обзор Mini-CRM')
    expect(video).toHaveAttribute('controls')
    expect(video).toHaveAttribute('preload', 'none')
    expect(video).toHaveAttribute('poster', '/media/mini-crm-demo-poster.jpg')
    expect(video).toHaveAttribute('src', '/media/mini-crm-demo.mp4')
    expect(video).toHaveAttribute('width', '1280')
    expect(video).toHaveAttribute('height', '720')
    for (const attr of ['autoplay', 'muted', 'loop']) expect(video).not.toHaveAttribute(attr)
    // jsdom has no textTracks and the lint rules forbid node access: inspect the markup instead
    const track = /<track [^>]*>/.exec(video.innerHTML)?.[0] ?? ''
    expect(track).toContain('kind="captions"')
    expect(track).toContain('srclang="ru"')
    expect(track).toContain('src="/media/mini-crm-demo.ru.vtt"')
    expect(track).not.toContain(' default')
  })

  it('links to the assignment in Google Docs in a new tab', () => {
    renderAbout(SIGNED_OUT)
    const link = screen.getByRole('link', { name: /Техническое задание/ })
    expect(link).toHaveAttribute(
      'href',
      'https://docs.google.com/document/d/1dpyRJ1E__eD0cisYSj0GDml4xtTTPaLe/edit?usp=sharing',
    )
    expect(link).toHaveAttribute('target', '_blank')
    expect(link).toHaveAttribute('rel', 'noreferrer')
    expect(link).toHaveAccessibleName(/откроется в новой вкладке/)
  })

  it('publishes only the author contacts, no demo login', () => {
    const { container } = renderAbout(SIGNED_OUT)
    expect(container.textContent).not.toMatch(/@example\.(com|test)/)
    expect(screen.getByRole('heading', { level: 2, name: 'Автор' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /paterfamelias@gmail\.com/ })).toHaveAttribute(
      'href',
      'mailto:paterfamelias@gmail.com',
    )
    const telegram = screen.getByRole('link', { name: /@Kor2710/ })
    expect(telegram).toHaveAttribute('href', 'https://t.me/Kor2710')
    expect(telegram).toHaveAttribute('target', '_blank')
    expect(telegram).toHaveAttribute('rel', 'noreferrer')
    expect(telegram).toHaveAccessibleName(/откроется в новой вкладке/)
  })

  it('sets the document title', () => {
    renderAbout(SIGNED_OUT)
    expect(document.title).toBe('О проекте — Mini-CRM')
  })

  it.each([
    ['signed out', SIGNED_OUT],
    ['signed in', SIGNED_IN],
  ])('has no accessibility violations (%s)', async (_name, session) => {
    const { container } = renderAbout(session)
    await expectNoAxeViolations(container)
  })
})
