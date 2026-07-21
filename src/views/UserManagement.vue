<template>
  <div class="user-management-page">
    <el-card shadow="never">
      <template #header>
        <div class="list-header">
          <span>用户管理</span>
          <el-button type="primary" @click="openDialog">新建用户</el-button>
        </div>
      </template>
      <el-table v-loading="loading" :data="users" stripe>
        <el-table-column prop="username" label="用户名" width="160" />
        <el-table-column prop="role" label="角色" width="120">
          <template #default="{ row }">
            {{ roleLabel(row.role) }}
          </template>
        </el-table-column>
        <el-table-column prop="displayName" label="显示名" width="160" />
        <el-table-column prop="email" label="邮箱" />
        <el-table-column prop="createdAt" label="创建时间" width="180" />
      </el-table>
    </el-card>

    <el-dialog v-model="dialogVisible" title="新建用户" width="500px">
      <el-form :model="form" label-width="100px">
        <el-form-item label="用户名">
          <el-input v-model="form.username" placeholder="请输入用户名" />
        </el-form-item>
        <el-form-item label="密码">
          <el-input v-model="form.password" type="password" placeholder="请输入密码" />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="form.role" placeholder="请选择角色" style="width: 100%">
            <el-option label="售后测试" value="after_sales" />
            <el-option label="研发" value="rd" />
            <el-option label="管理员" value="admin" />
          </el-select>
        </el-form-item>
        <el-form-item label="显示名">
          <el-input v-model="form.displayName" placeholder="可选" />
        </el-form-item>
        <el-form-item label="邮箱">
          <el-input v-model="form.email" placeholder="可选" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="submitting" @click="onSubmit">提交</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { createUser, listUsers, type User } from '@/api/users'

const users = ref<User[]>([])
const loading = ref(false)
const dialogVisible = ref(false)
const submitting = ref(false)
const error = ref('')

const form = reactive({
  username: '',
  password: '',
  role: 'after_sales' as User['role'],
  displayName: '',
  email: ''
})

onMounted(() => {
  loadUsers()
})

async function loadUsers() {
  loading.value = true
  try {
    users.value = await listUsers()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败'
  } finally {
    loading.value = false
  }
}

function openDialog() {
  form.username = ''
  form.password = ''
  form.role = 'after_sales'
  form.displayName = ''
  form.email = ''
  error.value = ''
  dialogVisible.value = true
}

async function onSubmit() {
  if (!form.username.trim() || !form.password.trim()) {
    error.value = '用户名和密码不能为空'
    return
  }
  submitting.value = true
  try {
    await createUser({
      username: form.username.trim(),
      password: form.password,
      role: form.role,
      displayName: form.displayName.trim() || undefined,
      email: form.email.trim() || undefined
    })
    dialogVisible.value = false
    await loadUsers()
  } catch (e) {
    error.value = e instanceof Error ? e.message : '创建失败'
  } finally {
    submitting.value = false
  }
}

function roleLabel(role: User['role']) {
  const map: Record<User['role'], string> = {
    after_sales: '售后测试',
    rd: '研发',
    admin: '管理员'
  }
  return map[role] || role
}
</script>

<style scoped>
.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
</style>
