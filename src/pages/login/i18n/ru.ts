/** Texts of the sign-in page. Namespace: `login`. */
export const loginRu = {
  title: 'Вход в Mini-CRM',
  description: 'Введите email и пароль, которые вам выдали.',
  email: 'Email',
  password: 'Пароль',
  submit: 'Войти',
  validation: {
    emailInvalid: 'Введите корректный email',
    passwordRequired: 'Введите пароль',
  },
  errors: {
    invalidCredentials: 'Неверный email или пароль',
    generic: 'Не удалось войти. Попробуйте ещё раз',
  },
} as const
