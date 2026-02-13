import 'package:cloud_firestore/cloud_firestore.dart';
import 'package:flutter/material.dart';

import '../../services/area_service.dart';
import '../../services/user_service.dart';

class OwnerDeliveryScreen extends StatefulWidget {
  const OwnerDeliveryScreen({super.key});

  @override
  State<OwnerDeliveryScreen> createState() => _OwnerDeliveryScreenState();
}

class _OwnerDeliveryScreenState extends State<OwnerDeliveryScreen> {
  final _userService = UserService();
  final _areaService = AreaService();

  Future<void> _openAddAgentDialog() async {
    final formKey = GlobalKey<FormState>();
    final nameController = TextEditingController();
    final phoneController = TextEditingController();
    String? selectedArea;
    String? dialogError;
    bool saving = false;

    final created = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return StatefulBuilder(
          builder: (dialogContext, setDialogState) {
            return AlertDialog(
              title: const Text('Add Delivery Agent'),
              content: Form(
                key: formKey,
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      TextFormField(
                        controller: nameController,
                        decoration: const InputDecoration(
                          labelText: 'Name of the delivery agent',
                          border: OutlineInputBorder(),
                        ),
                        validator: (value) {
                          if (value == null || value.trim().isEmpty) {
                            return 'Enter name';
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: phoneController,
                        keyboardType: TextInputType.phone,
                        maxLength: 10,
                        decoration: const InputDecoration(
                          labelText: 'Phone number',
                          border: OutlineInputBorder(),
                          counterText: '',
                        ),
                        validator: (value) {
                          final phone = (value ?? '').trim();
                          if (phone.length != 10) return 'Enter 10-digit number';
                          return null;
                        },
                      ),
                      const SizedBox(height: 12),
                      StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
                        stream: _areaService.watchAreas(),
                        builder: (context, snapshot) {
                          final docs = snapshot.data?.docs ?? [];
                          final areas = docs
                              .map((doc) => (doc.data()['name'] ?? '').toString())
                              .where((name) => name.isNotEmpty)
                              .toList();
                          if (selectedArea == null && areas.isNotEmpty) {
                            selectedArea = areas.first;
                          }
                          return DropdownButtonFormField<String>(
                            value: selectedArea,
                            decoration: const InputDecoration(
                              labelText: 'Area assignment',
                              border: OutlineInputBorder(),
                            ),
                            items: areas
                                .map((area) => DropdownMenuItem(
                                      value: area,
                                      child: Text(area),
                                    ))
                                .toList(),
                            onChanged: (value) =>
                                setDialogState(() => selectedArea = value),
                            validator: (value) {
                              if (value == null || value.isEmpty) {
                                return 'Select area';
                              }
                              return null;
                            },
                          );
                        },
                      ),
                      if (dialogError != null) ...[
                        const SizedBox(height: 8),
                        Text(
                          dialogError!,
                          style: const TextStyle(color: Colors.red),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              actions: [
                TextButton(
                  onPressed:
                      saving ? null : () => Navigator.of(dialogContext).pop(false),
                  child: const Text('Cancel'),
                ),
                FilledButton(
                  onPressed: saving
                      ? null
                      : () async {
                          if (!formKey.currentState!.validate()) return;
                          setDialogState(() {
                            saving = true;
                            dialogError = null;
                          });
                          try {
                            await _userService.addDeliveryAgent(
                              name: nameController.text.trim(),
                              phone: phoneController.text.trim(),
                              area: selectedArea ?? '',
                            );
                            if (!dialogContext.mounted) return;
                            Navigator.of(dialogContext).pop(true);
                          } catch (e) {
                            if (dialogContext.mounted) {
                              setDialogState(() {
                                dialogError =
                                    e.toString().replaceFirst('Bad state: ', '');
                              });
                            }
                          } finally {
                            if (dialogContext.mounted) {
                              setDialogState(() => saving = false);
                            }
                          }
                        },
                  child: saving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Add'),
                ),
              ],
            );
          },
        );
      },
    );
    if (created == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Delivery agent added')),
      );
    }
    nameController.dispose();
    phoneController.dispose();
  }

  Future<void> _openEditAgentDialog({
    required String phone,
    required String initialName,
    required String initialArea,
  }) async {
    final formKey = GlobalKey<FormState>();
    final nameController = TextEditingController(text: initialName);
    String? selectedArea = initialArea;
    String? dialogError;
    bool saving = false;

    final updated = await showDialog<bool>(
      context: context,
      builder: (dialogContext) {
        return StatefulBuilder(
          builder: (dialogContext, setDialogState) {
            return AlertDialog(
              title: const Text('Edit Delivery Agent'),
              content: Form(
                key: formKey,
                child: SingleChildScrollView(
                  child: Column(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      TextFormField(
                        initialValue: phone,
                        readOnly: true,
                        decoration: const InputDecoration(
                          labelText: 'Phone number',
                          border: OutlineInputBorder(),
                        ),
                      ),
                      const SizedBox(height: 12),
                      TextFormField(
                        controller: nameController,
                        decoration: const InputDecoration(
                          labelText: 'Name',
                          border: OutlineInputBorder(),
                        ),
                        validator: (value) {
                          if (value == null || value.trim().isEmpty) {
                            return 'Enter name';
                          }
                          return null;
                        },
                      ),
                      const SizedBox(height: 12),
                      StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
                        stream: _areaService.watchAreas(),
                        builder: (context, snapshot) {
                          final docs = snapshot.data?.docs ?? [];
                          final areas = docs
                              .map((doc) => (doc.data()['name'] ?? '').toString())
                              .where((name) => name.isNotEmpty)
                              .toList();
                          if (selectedArea == null && areas.isNotEmpty) {
                            selectedArea = areas.first;
                          }
                          return DropdownButtonFormField<String>(
                            value: selectedArea,
                            decoration: const InputDecoration(
                              labelText: 'Area assignment',
                              border: OutlineInputBorder(),
                            ),
                            items: areas
                                .map((area) => DropdownMenuItem(
                                      value: area,
                                      child: Text(area),
                                    ))
                                .toList(),
                            onChanged: (value) =>
                                setDialogState(() => selectedArea = value),
                            validator: (value) {
                              if (value == null || value.isEmpty) {
                                return 'Select area';
                              }
                              return null;
                            },
                          );
                        },
                      ),
                      if (dialogError != null) ...[
                        const SizedBox(height: 8),
                        Text(
                          dialogError!,
                          style: const TextStyle(color: Colors.red),
                        ),
                      ],
                    ],
                  ),
                ),
              ),
              actions: [
                TextButton(
                  onPressed:
                      saving ? null : () => Navigator.of(dialogContext).pop(false),
                  child: const Text('Cancel'),
                ),
                FilledButton(
                  onPressed: saving
                      ? null
                      : () async {
                          if (!formKey.currentState!.validate()) return;
                          setDialogState(() {
                            saving = true;
                            dialogError = null;
                          });
                          try {
                            await _userService.updateDeliveryAgent(
                              oldPhone: phone,
                              name: nameController.text.trim(),
                              area: selectedArea ?? initialArea,
                            );
                            if (!dialogContext.mounted) return;
                            Navigator.of(dialogContext).pop(true);
                          } catch (e) {
                            if (dialogContext.mounted) {
                              setDialogState(() {
                                dialogError =
                                    e.toString().replaceFirst('Bad state: ', '');
                              });
                            }
                          } finally {
                            if (dialogContext.mounted) {
                              setDialogState(() => saving = false);
                            }
                          }
                        },
                  child: saving
                      ? const SizedBox(
                          width: 18,
                          height: 18,
                          child: CircularProgressIndicator(strokeWidth: 2),
                        )
                      : const Text('Save'),
                ),
              ],
            );
          },
        );
      },
    );

    if (updated == true && mounted) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Delivery agent updated')),
      );
    }
    nameController.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Delivery Agents')),
      floatingActionButton: FloatingActionButton.extended(
        onPressed: _openAddAgentDialog,
        icon: const Icon(Icons.person_add),
        label: const Text('Add Delivery Agent'),
      ),
      body: SafeArea(
        child: StreamBuilder<QuerySnapshot<Map<String, dynamic>>>(
          stream: _userService.watchDeliveryAgents(),
          builder: (context, snapshot) {
            if (snapshot.connectionState == ConnectionState.waiting) {
              return const Center(child: CircularProgressIndicator());
            }

            final docs = snapshot.data?.docs ?? [];
            if (docs.isEmpty) {
              return const Center(child: Text('No delivery agents yet'));
            }

            return ListView.separated(
              padding: const EdgeInsets.fromLTRB(16, 16, 16, 88),
              itemCount: docs.length,
              separatorBuilder: (_, __) => const SizedBox(height: 12),
              itemBuilder: (context, index) {
                final doc = docs[index];
                final data = doc.data();
                final name = (data['name'] ?? 'Agent').toString();
                final phone = (data['phone'] ?? '').toString();
                final area = (data['area'] ?? '').toString();
                final active = data['active'] == true;

                return Card(
                  child: ListTile(
                    title: Text(name),
                    subtitle: Text('Phone: $phone\nArea: $area'),
                    isThreeLine: true,
                    trailing: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        IconButton(
                          tooltip: 'Edit',
                          icon: const Icon(Icons.edit),
                          onPressed: () => _openEditAgentDialog(
                            phone: phone,
                            initialName: name,
                            initialArea: area,
                          ),
                        ),
                        Switch(
                          value: active,
                          onChanged: (value) =>
                              _userService.setDeliveryAgentActive(phone, value),
                        ),
                      ],
                    ),
                  ),
                );
              },
            );
          },
        ),
      ),
    );
  }
}
