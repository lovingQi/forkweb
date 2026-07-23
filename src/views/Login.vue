<template>
  <div class="login-page">
    <div class="login-card">
      <div class="login-logo">
        <img src="/logo.png" alt="Junion" class="logo-img" />
      </div>
      <h2 class="login-title">Junion 单机售后工单系统</h2>
      <el-form :model="form" @submit.prevent="onLogin" class="login-form">
        <div class="form-group">
          <label class="form-label">用户名</label>
          <el-input v-model="form.username" placeholder="请输入用户名" size="large" />
        </div>
        <div class="form-group">
          <label class="form-label">密码</label>
          <el-input v-model="form.password" type="password" placeholder="请输入密码" show-password size="large" />
        </div>
        <el-button type="primary" :loading="auth.loading" class="login-btn" size="large" @click="onLogin">登录</el-button>
      </el-form>
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon class="login-error" />
    </div>
    <div class="login-footer">&copy; 2026 Junion</div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { useAuthStore } from '@/stores/auth'

const router = useRouter()
const auth = useAuthStore()
const error = ref('')

const form = reactive({
  username: '',
  password: ''
})

async function onLogin() {
  error.value = ''
  try {
    await auth.login(form.username, form.password)
    router.push('/tickets')
  } catch (e) {
    error.value = e instanceof Error ? e.message : '登录失败'
  }
}
</script>

<style scoped>
.login-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  background:
    radial-gradient(circle at 20% 80%, rgba(37, 99, 235, 0.15) 0%, transparent 50%),
    radial-gradient(circle at 80% 20%, rgba(59, 130, 246, 0.12) 0%, transparent 50%),
    linear-gradient(135deg, #0f172a 0%, #1e293b 50%, #0f172a 100%);
  background-size: cover;
  position: relative;
  overflow: hidden;
}

.login-page::before {
  content: '';
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(rgba(255, 255, 255, 0.03) 1px, transparent 1px);
  background-size: 24px 24px;
  pointer-events: none;
}

.login-card {
  position: relative;
  width: 420px;
  padding: 40px 36px 32px;
  background: rgba(255, 255, 255, 0.88);
  backdrop-filter: blur(24px);
  -webkit-backdrop-filter: blur(24px);
  border-radius: 16px;
  box-shadow:
    0 8px 32px rgba(0, 0, 0, 0.18),
    0 0 0 1px rgba(255, 255, 255, 0.1);
}

.login-logo {
  text-align: center;
  margin-bottom: 12px;
}

.logo-img {
  height: 48px;
  width: auto;
}

.login-title {
  text-align: center;
  font-size: 20px;
  font-weight: 600;
  color: #1e293b;
  margin: 0 0 28px;
  letter-spacing: 0.5px;
}

.login-form {
  display: flex;
  flex-direction: column;
  gap: 18px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.form-label {
  font-size: 13px;
  font-weight: 500;
  color: #475569;
}

.login-btn {
  width: 100%;
  margin-top: 6px;
  height: 42px;
  font-size: 15px;
  font-weight: 600;
  border-radius: 8px;
  background: linear-gradient(135deg, #2563eb 0%, #3b82f6 100%);
  border: none;
}

.login-btn:hover {
  background: linear-gradient(135deg, #1d4ed8 0%, #2563eb 100%);
}

.login-error {
  margin-top: 16px;
}

.login-footer {
  position: absolute;
  bottom: 24px;
  color: rgba(255, 255, 255, 0.4);
  font-size: 12px;
  letter-spacing: 0.5px;
}
</style>
