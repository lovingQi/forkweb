<template>
  <div class="login-page">
    <el-card class="login-card" shadow="never">
      <template #header>
        <div class="login-header">forkweb 售后工单系统</div>
      </template>
      <el-form :model="form" label-width="80px" @submit.prevent="onLogin">
        <el-form-item label="用户名">
          <el-input v-model="form.username" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" placeholder="请输入密码" show-password />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" :loading="auth.loading" @click="onLogin">登录</el-button>
        </el-form-item>
      </el-form>
      <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
      <div class="login-tip">
        默认管理员账号：admin / admin123
      </div>
    </el-card>
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
  align-items: center;
  justify-content: center;
  background: #f3f4f6;
}
.login-card {
  width: 420px;
}
.login-header {
  text-align: center;
  font-size: 18px;
  font-weight: 600;
}
.login-tip {
  margin-top: 16px;
  color: #6b7280;
  font-size: 13px;
  text-align: center;
}
</style>
